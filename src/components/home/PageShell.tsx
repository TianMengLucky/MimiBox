import { Box } from "@apvee/react-layout-kit";
import type { ReactNode } from "react";

/** 简单页面外壳（home / library 共用）：垂直排列 + 居中；布局骨架走 layout-kit */
export function PageShell({ children }: { children: ReactNode }) {
  return (
    <Box
      asChild
      $minHeight="100dvh"
      $padding="14vh 96px 48px"
      $display="flex"
      $flexDirection="column"
      $alignItems="center"
    >
      <main className="page-in">{children}</main>
    </Box>
  );
}

/** 入口卡片网格（home / library 共用）：auto-fill 自适应列数，布局骨架走 layout-kit */
export function CardGrid({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Box
      asChild
      $display="grid"
      $gridTemplateColumns="repeat(auto-fill, minmax(190px, 1fr))"
      $gap={18}
      $width="min(880px, 100%)"
      $margin="24px 0 0"
      $padding={0}
      $listStyle="none"
    >
      <ul aria-label={label}>{children}</ul>
    </Box>
  );
}
