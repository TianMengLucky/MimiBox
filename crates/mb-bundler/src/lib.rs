//! 插件前端打包器：把 ESM/TSX 源码打成与宿主运行时约定一致的单文件
//! CJS 工厂 bundle（esbuild 的 Rust 替代，基于 Oxc 工具链）。
//!
//! 输出约定（与 scripts/plugin-config.mjs 的 esbuild 配置完全一致）：
//! `window.__mb_plugins["<id>"] = function(require, module, exports) { ... }`
//! react/@lib/* 等共享依赖不进 bundle，运行时经宿主 `require` 提供；
//! 本地相对导入递归内联为模块表 `__mb_modules`。
//!
//! 转换范围（与 esbuild 版本对齐）：
//! - TypeScript 类型剥离 + JSX（automatic runtime → react/jsx-runtime）
//! - `import.meta.env.DEV` → `false`；其余 `import.meta` → `({})`（CJS 无
//!   import.meta，与 esbuild 行为一致）
//! - ESM import/export → CJS（导出赋值置于模块体末尾；不支持循环依赖下
//!   的部分初始化，与打包器通用限制一致）
//!
//! 模块级边角（解构导出等）不支持时显式报错，不静默产出错误代码。

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

use oxc_allocator::{Allocator, GetAllocator, TakeIn};
use oxc_ast::ast::{
    AssignmentOperator, AssignmentTarget, BindingPattern, Declaration,
    ExportDefaultDeclarationKind, Expression, IdentifierName, IdentifierReference,
    ImportDeclarationSpecifier, ImportOrExportKind, ModuleExportName, Statement,
    StaticMemberExpression,
};
use oxc_ast::builder::AstBuilder;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::{Span, SourceType};
use oxc_transformer::{JsxOptions, TransformOptions, Transformer};

/// 打包参数
pub struct BundleOptions<'a> {
    /// 前端入口文件（如 `<插件目录>/frontend/index.tsx`）
    pub entry: &'a Path,
    /// 插件 id（bundle 以此注册到 window.__mb_plugins）
    pub id: &'a str,
    /// 输出文件（如 `<插件目录>/frontend/index.js`）
    pub out: &'a Path,
}

/// 打包前端入口为单文件 CJS 工厂 bundle 并写出。
pub fn bundle(options: BundleOptions) -> Result<(), String> {
    let entry = options
        .entry
        .canonicalize()
        .map_err(|e| format!("无法读取前端入口 {}: {e}", options.entry.display()))?;
    let root = entry
        .parent()
        .ok_or_else(|| "前端入口没有父目录".to_string())?
        .to_path_buf();

    let mut bundler = Bundler {
        root,
        entry_key: String::new(),
        by_path: HashMap::new(),
        modules: BTreeMap::new(),
    };

    let key = bundler.collect(&entry)?;
    bundler.entry_key = key;

    fs::write(options.out, bundler.render(options.id))
        .map_err(|e| format!("无法写出 bundle {}: {e}", options.out.display()))
}

/// 单个模块的转换产物
struct ModuleBuild {
    /// 模块体（prologue + codegen body + epilogue）
    code: String,
    /// 本模块引用的本地模块路径（继续递归用）
    deps: Vec<PathBuf>,
}

struct Bundler {
    /// 前端根目录（entry 所在目录；模块 key 相对它计算）
    root: PathBuf,
    entry_key: String,
    /// canonical 路径 → 模块 key
    by_path: HashMap<PathBuf, String>,
    /// key → 模块产物（BTreeMap 保证输出顺序稳定）
    modules: BTreeMap<String, ModuleBuild>,
}

impl Bundler {
    /// 递归收集并转换一个模块；返回其 key
    fn collect(&mut self, path: &Path) -> Result<String, String> {
        let canonical = path
            .canonicalize()
            .map_err(|e| format!("无法读取模块 {}: {e}", path.display()))?;
        if let Some(key) = self.by_path.get(&canonical) {
            return Ok(key.clone());
        }
        let key = path_to_key(&canonical, &self.root)?;
        self.by_path.insert(canonical.clone(), key.clone());

        let module = self.build_module(&canonical, &key)?;
        let deps = module.deps.clone();
        self.modules.insert(key.clone(), module);
        for dep in deps {
            self.collect(&dep)?;
        }
        Ok(key)
    }

    fn build_module(&self, path: &Path, key: &str) -> Result<ModuleBuild, String> {
        let source_text =
            fs::read_to_string(path).map_err(|e| format!("无法读取 {path:?}: {e}"))?;
        // import.meta.env.DEV 常量替换；其余 import.meta 在 CJS 中替换为
        // 空对象（esbuild 同行为）。先替换更长的 DEV 形式避免前缀截断。
        let source_text = source_text
            .replace("import.meta.env.DEV", "false")
            .replace("import.meta", "({})");

        let source_type = source_type_of(path);
        let allocator = Allocator::default();

        let parser_return = Parser::new(&allocator, source_text.as_str(), source_type).parse();
        if !parser_return.diagnostics.is_empty() {
            let detail = parser_return
                .diagnostics
                .iter()
                .map(|d| d.message.to_string())
                .collect::<Vec<_>>()
                .join("\n");
            return Err(format!("模块 {key} 语法错误：\n{detail}"));
        }
        let mut program = parser_return.program;

        let scoping = SemanticBuilder::new().build(&program).semantic.into_scoping();
        let transform_options = TransformOptions {
            jsx: JsxOptions::enable(),
            ..TransformOptions::default()
        };
        let transform_return = Transformer::new(&allocator, path, &transform_options)
            .build_with_scoping(scoping, &mut program);
        if transform_return.diagnostics.has_errors() {
            return Err(format!("模块 {key} 转换失败（TS/JSX）"));
        }

        // 分拣顶层语句：import → prologue 文本；export → 剥壳保留 + epilogue
        // 赋值文本；其余原样保留
        let ast = AstBuilder::new(&allocator);
        let arena = ast.allocator();
        let body = std::mem::replace(&mut program.body, oxc_allocator::Vec::new_in(&arena));
        let mut kept: Vec<Statement> = Vec::with_capacity(body.len());
        let mut prologue: Vec<String> = Vec::new();
        let mut epilogue: Vec<String> = Vec::new();
        let mut deps: Vec<PathBuf> = Vec::new();

        for stmt in body {
            match stmt {
                Statement::ImportDeclaration(decl) => {
                    if decl.import_kind == ImportOrExportKind::Type {
                        continue;
                    }
                    let req = self.require_expr(&decl.source.value, path, &mut deps)?;
                    match &decl.specifiers {
                        Some(specifiers) => {
                            emit_import(specifiers, &req, &mut prologue);
                        }
                        // 纯副作用导入 `import 'foo'`
                        None => prologue.push(format!("{req};")),
                    }
                }
                Statement::ExportAllDeclaration(decl) => {
                    if decl.export_kind == ImportOrExportKind::Type {
                        continue;
                    }
                    let req = self.require_expr(&decl.source.value, path, &mut deps)?;
                    match &decl.exported {
                        // `export * as ns from "mod"` → exports.ns = require(...);
                        Some(exported) => {
                            let name = export_name(exported)?;
                            epilogue.push(format!("exports.{name} = {req};"));
                        }
                        // `export * from "mod"` → 逐键转发（跳过 default）
                        None => epilogue.push(format!("__mb_reexport(exports, {req});")),
                    }
                }
                Statement::ExportDefaultDeclaration(decl) => {
                    let mut export = decl;
                    match &mut export.declaration {
                        ExportDefaultDeclarationKind::FunctionDeclaration(function) => {
                            if let Some(id) = &function.id {
                                epilogue.push(format!("exports.default = {};", id.name));
                            }
                            let owned = TakeIn::take_in_box(&mut **function, &arena);
                            kept.push(Statement::FunctionDeclaration(owned));
                        }
                        ExportDefaultDeclarationKind::ClassDeclaration(class) => {
                            if let Some(id) = &class.id {
                                epilogue.push(format!("exports.default = {};", id.name));
                            }
                            let owned = TakeIn::take_in_box(&mut **class, &arena);
                            kept.push(Statement::ClassDeclaration(owned));
                        }
                        kind => match kind.as_expression_mut() {
                            Some(expr_mut) => {
                                let expr = TakeIn::take_in(expr_mut, &arena);
                                kept.push(exports_assignment(&ast, "default", expr));
                            }
                            // TS 接口等类型默认导出已被剥离；兜底忽略
                            None => {}
                        },
                    }
                }
                Statement::ExportDeclaration(mut decl) => {
                    // `export const a = 1` / `export function f()`：剥掉 export
                    // 保留声明本体，导出赋值放 epilogue
                    let declaration = TakeIn::take_in(&mut decl.declaration, &arena);
                    collect_declaration_exports(&declaration, &mut epilogue)?;
                    kept.push(declaration_to_statement(declaration));
                }
                Statement::ExportNamedDeclaration(decl) => {
                    // `export { a, b as c };`
                    if decl.export_kind == ImportOrExportKind::Type {
                        continue;
                    }
                    for spec in &decl.specifiers {
                        if spec.export_kind == ImportOrExportKind::Type {
                            continue;
                        }
                        let exported = export_name(&spec.exported)?;
                        let value = export_name(&spec.local)?;
                        epilogue.push(format!("exports.{exported} = {value};"));
                    }
                }
                Statement::ExportFromDeclaration(decl) => {
                    // `export { x } from "mod";`
                    if decl.export_kind == ImportOrExportKind::Type {
                        continue;
                    }
                    let req = self.require_expr(&decl.source.value, path, &mut deps)?;
                    for spec in &decl.specifiers {
                        if spec.export_kind == ImportOrExportKind::Type {
                            continue;
                        }
                        let exported = export_name(&spec.exported)?;
                        let value = export_name(&spec.local)?;
                        epilogue
                            .push(format!("exports.{exported} = {}; ", member_text(&req, &value)));
                    }
                }
                other => kept.push(other),
            }
        }
        program.body = oxc_allocator::Vec::from_iter_in(kept, &arena);
        let body_code = Codegen::new()
            .with_options(CodegenOptions::default())
            .build(&program)
            .code
            .to_string();

        let mut code = String::with_capacity(body_code.len() + 128);
        for line in &prologue {
            code.push_str(line);
            code.push('\n');
        }
        code.push_str(&body_code);
        for line in &epilogue {
            code.push_str(line);
            code.push('\n');
        }
        Ok(ModuleBuild { code, deps })
    }

    /// 生成某导入来源的 require 表达式文本：
    /// 本地相对导入 → `__mb_require("<key>")`；外部依赖 → `require("<spec>")`
    fn require_expr(
        &self,
        spec: &str,
        importer: &Path,
        deps: &mut Vec<PathBuf>,
    ) -> Result<String, String> {
        if !spec.starts_with('.') {
            return Ok(format!("require({})", js_quote(spec)));
        }
        let resolved = resolve_spec(
            importer
                .parent()
                .ok_or_else(|| format!("模块 {spec} 的导入方没有父目录"))?,
            spec,
        )
        .ok_or_else(|| format!("无法解析本地导入「{spec}」（来自 {importer:?}）"))?;
        let canonical = resolved
            .canonicalize()
            .map_err(|e| format!("无法读取导入「{spec}」: {e}"))?;
        let key = path_to_key(&canonical, &self.root)?;
        deps.push(canonical);
        Ok(format!("__mb_require({})", js_quote(&key)))
    }

    /// 输出单文件 CJS 工厂 bundle
    fn render(self, id: &str) -> String {
        let mut out = String::with_capacity(8 * 1024);
        out.push_str("window.__mb_plugins=window.__mb_plugins||{};window.__mb_plugins[");
        out.push_str(&js_quote(id));
        out.push_str("]=function(require,module,exports){\n");
        out.push_str(
            r#""use strict";
var __toESM = (m) => { if (m && m.__esModule) return m; var n = {}; if (m != null) for (var k in m) n[k] = m[k]; n.default = m; return n; };
var __mb_reexport = (exports, mod) => { var ks = Object.keys(mod); for (var i = 0; i < ks.length; i++) { var k = ks[i]; if (k !== "default" && !Object.prototype.hasOwnProperty.call(exports, k)) Object.defineProperty(exports, k, { enumerable: true, get: () => mod[k] }); } };
var __mb_modules = {
"#,
        );
        let total = self.modules.len();
        for (index, (key, module)) in self.modules.iter().enumerate() {
            out.push_str(&js_quote(key));
            out.push_str(": function (require, module, exports) {\n");
            out.push_str(&module.code);
            out.push('}');
            if index + 1 < total {
                out.push(',');
            }
            out.push('\n');
        }
        out.push_str(
            "};\nvar __mb_cache = {};\nfunction __mb_require(key) { var hit = __mb_cache[key]; if (hit) return hit; var m = { exports: {} }; __mb_modules[key](require, m, m.exports); __mb_cache[key] = m.exports; return m.exports; }\n",
        );
        out.push_str(&format!(
            "module.exports = __mb_require({});\n",
            js_quote(&self.entry_key)
        ));
        out.push_str("};");
        out
    }
}

/// 本地模块的 require key：相对前端根目录的正斜杠路径（"./store" 形式）
fn path_to_key(path: &Path, root: &Path) -> Result<String, String> {
    let rel = path
        .strip_prefix(root)
        .map_err(|_| format!("模块 {path:?} 不在前端根目录 {root:?} 内"))?;
    let text = rel.to_string_lossy().replace('\\', "/");
    Ok(format!("./{text}"))
}

fn source_type_of(path: &Path) -> SourceType {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
    {
        "tsx" => SourceType::tsx(),
        "jsx" => SourceType::jsx(),
        "ts" | "mts" | "cts" => SourceType::ts(),
        // .js / .mjs / 其他：按 module JS 解析（不含 JSX，与 esbuild 一致）
        _ => SourceType::mjs(),
    }
}

/// 解析相对导入的物理路径：精确 → 补扩展名 → 目录 index
fn resolve_spec(base: &Path, spec: &str) -> Option<PathBuf> {
    let joined = base.join(spec);
    let mut candidates: Vec<PathBuf> = vec![joined.clone()];
    for ext in ["ts", "tsx", "js", "jsx", "mjs"] {
        candidates.push(PathBuf::from(format!("{}.{}", joined.display(), ext)));
    }
    for ext in ["ts", "tsx", "js", "jsx"] {
        candidates.push(joined.join(format!("index.{ext}")));
    }
    candidates.into_iter().find(|p| p.is_file())
}

/// 生成一组 import 的绑定文本（挂到 prologue）
fn emit_import(
    specifiers: &[ImportDeclarationSpecifier],
    require_expr: &str,
    prologue: &mut Vec<String>,
) {
    // 单一绑定直接取；多绑定先落临时变量再分发
    let holder = if specifiers.len() > 1 {
        let name = format!("_mb_{}", prologue.len());
        prologue.push(format!("var {name} = __toESM({require_expr});"));
        Some(name)
    } else {
        None
    };
    for spec in specifiers {
        let line = match spec {
            ImportDeclarationSpecifier::ImportDefaultSpecifier(s) => {
                let access = member_text(holder.as_deref().unwrap_or(require_expr), "default");
                format!("var {} = {access};", s.local.name)
            }
            ImportDeclarationSpecifier::ImportNamespaceSpecifier(s) => format!(
                "var {} = {};",
                s.local.name,
                holder.as_deref().unwrap_or(require_expr)
            ),
            ImportDeclarationSpecifier::ImportSpecifier(s) => {
                if s.import_kind == ImportOrExportKind::Type {
                    continue;
                }
                let imported = module_export_name_text(&s.imported);
                let access = member_text(holder.as_deref().unwrap_or(require_expr), &imported);
                format!("var {} = {access};", s.local.name)
            }
        };
        prologue.push(line);
    }
}

/// `base.name` / `base["name"]` 文本（非合法标识符用方括号）
fn member_text(base: &str, name: &str) -> String {
    if is_identifier(name) {
        format!("{base}.{name}")
    } else {
        format!("{base}[{}]", js_quote(name))
    }
}

fn module_export_name_text(name: &ModuleExportName) -> String {
    match name {
        ModuleExportName::IdentifierName(name) => name.name.to_string(),
        ModuleExportName::IdentifierReference(id) => id.name.to_string(),
        ModuleExportName::StringLiteral(lit) => lit.value.to_string(),
    }
}

fn export_name(name: &ModuleExportName) -> Result<String, String> {
    let text = module_export_name_text(name);
    if text.is_empty() {
        return Err("导出名不能为空".to_string());
    }
    Ok(text)
}

/// 收集「导出的声明」隐含的导出赋值（`export const a` → `exports.a = a;`）
fn collect_declaration_exports(
    declaration: &Declaration,
    epilogue: &mut Vec<String>,
) -> Result<(), String> {
    match declaration {
        Declaration::VariableDeclaration(decl) => {
            for declarator in &decl.declarations {
                match &declarator.id {
                    BindingPattern::BindingIdentifier(id) => {
                        epilogue.push(format!("exports.{} = {};", id.name, id.name));
                    }
                    _ => {
                        return Err(
                            "暂不支持解构形式的具名导出（export const {a, b} = ...），\
                             请改为逐个导出"
                                .to_string(),
                        );
                    }
                }
            }
        }
        Declaration::FunctionDeclaration(func) => {
            if let Some(id) = &func.id {
                epilogue.push(format!("exports.{} = {};", id.name, id.name));
            }
        }
        Declaration::ClassDeclaration(class) => {
            if let Some(id) = &class.id {
                epilogue.push(format!("exports.{} = {};", id.name, id.name));
            }
        }
        // TS 类型声明已被剥离；其余（TS enum 转换产物等）跳过
        _ => {}
    }
    Ok(())
}

/// Declaration → Statement（0.152 中 Statement 扁平化了 Declaration 变体）
fn declaration_to_statement(declaration: Declaration) -> Statement {
    match declaration {
        Declaration::VariableDeclaration(decl) => Statement::VariableDeclaration(decl),
        Declaration::FunctionDeclaration(func) => Statement::FunctionDeclaration(func),
        Declaration::ClassDeclaration(class) => Statement::ClassDeclaration(class),
        Declaration::TSEnumDeclaration(decl) => Statement::TSEnumDeclaration(decl),
        Declaration::TSNamespaceDeclaration(decl) => Statement::TSNamespaceDeclaration(decl),
        Declaration::TSGlobalDeclaration(decl) => Statement::TSGlobalDeclaration(decl),
        Declaration::TSImportEqualsDeclaration(decl) => {
            Statement::TSImportEqualsDeclaration(decl)
        }
        Declaration::TSTypeAliasDeclaration(_)
        | Declaration::TSInterfaceDeclaration(_)
        | Declaration::TSExternalModuleDeclaration(_) => {
            unreachable!("类型声明已被 TS 转换剥离，不应到达此处")
        }
    }
}

/// 构造 `exports.<name> = <value>;` 语句
fn exports_assignment<'a>(
    ast: &AstBuilder<'a>,
    name: &'a str,
    value: Expression<'a>,
) -> Statement<'a> {
    let exports = Expression::Identifier(oxc_allocator::Box::new_in(
        IdentifierReference::new(Span::default(), "exports", ast),
        ast,
    ));
    let member = oxc_allocator::Box::new_in(
        StaticMemberExpression::new(
            Span::default(),
            exports,
            IdentifierName::new(Span::default(), name, ast),
            false,
            ast,
        ),
        ast,
    );
    let target = AssignmentTarget::StaticMemberExpression(member);
    let assignment = Expression::new_assignment_expression(
        Span::default(),
        AssignmentOperator::Assign,
        target,
        value,
        ast,
    );
    Statement::new_expression_statement(Span::default(), assignment, ast)
}

fn is_identifier(text: &str) -> bool {
    !text.is_empty()
        && text
            .chars()
            .enumerate()
            .all(|(i, c)| c == '$' || c == '_' || c.is_alphabetic() || (i > 0 && c.is_numeric()))
}

/// JS 字符串字面量（JSON 转义即可作为合法 JS 双引号字符串）
fn js_quote(text: &str) -> String {
    serde_json::to_string(text).unwrap_or_else(|_| "\"\"".to_string())
}
