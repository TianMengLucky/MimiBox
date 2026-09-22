import { motion, useReducedMotion } from "motion/react";

/**
 * 页面级加载占位：品牌起伏点 + 文案。
 * 用 motion 弹性动效（三枚粉点相位错开起伏），入场淡入上浮；
 * 系统开启「减弱动态效果」时只做静态淡入，点位不循环动画。
 */
export function PageLoading({ label }: { label: string }) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className="flex flex-1 flex-col items-center justify-center gap-3"
      role="status"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
    >
      <span className="flex items-center gap-1.5" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="h-[9px] w-[9px] rounded-full bg-gradient-to-br from-[#f9a8c9] to-[#fb7299]"
            animate={
              reduceMotion
                ? { opacity: 0.85 }
                : { y: [0, -7, 0], opacity: [0.4, 1, 0.4] }
            }
            transition={
              reduceMotion
                ? undefined
                : {
                    duration: 1.1,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: i * 0.14,
                  }
            }
          />
        ))}
      </span>
      <p className="m-0 text-sm text-[#9b8a91]">{label}</p>
    </motion.div>
  );
}
