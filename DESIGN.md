# ONEIRA OS Design System

## Discovery

ONEIRA 梦面包是面向店长、运营和管理员的移动优先运营 SaaS。它支持营业日报、经营分析、周月复盘、目标月历、报货、产品中心、反馈中心和系统管理。改造目标是降低重复操作成本，同时保持所有角色权限和数据链路不变。

**Positioning:** 连锁烘焙门店的轻量经营控制室，而不是传统 ERP 后台。

**Brand adjectives:** 精确、年轻、可靠、有温度。

**Aesthetic essence:** quiet / operational / tactile。

## Committed direction

采用“轻量运营 OS”方向：温润浅灰背景、纸面内容层、单一紫罗兰品牌色、少量语义色。液态玻璃只用于顶部状态、抽屉和弹窗等层级关系，不再让每一张卡片都产生厚重的玻璃贴图效果。

**Signature move:** “今日驾驶舱 + 任务轨道”。首页先给出一个关键经营数字，再用短任务轨道引导用户完成日报、报货和复盘；所有低频能力仍通过完整导航和移动底部菜单可达。

## Tokens

- Display: Manrope when available; Chinese fallback PingFang SC / system sans.
- Body: DM Sans when available; Chinese fallback PingFang SC / system sans.
- Type ratio: 1.2, with 12 / 14 / 17 / 21 / 28 / 42px steps.
- Spacing base: 4px; common rhythm 8 / 12 / 16 / 24 / 32.
- Radius: 12px controls; 20px content panels.
- Shadow: one restrained soft elevation; do not stack strong shadow and heavy border.
- Background: #F4F3F1.
- Surface: #FBFAF8.
- Foreground: #1E1C23.
- Muted: #807B86.
- Border: #E5E1DC.
- Accent: #6853C8.
- Accent surface: #EBE7FF.
- Success: #D9EEE8 / #28766A.
- Warning: #F4E0B4 / #966F21.
- Error: #F1D6DD / #A0445C.

## Layout and information hierarchy

The desktop layout keeps the complete sidebar. The mobile layout keeps a compact current-page button and a labelled menu button; the full permission-aware navigation opens as a bottom sheet. No module is removed from navigation. The first screen prioritizes 5–9 actionable metrics, then tasks, then detail.

Forms use tight spacing inside a group and generous spacing between groups. Daily reports remain one continuous form, with computed values visually distinct from editable fields. Lists use row density and progressive disclosure rather than tall cards.

## Interaction and states

Every primary action has default, hover, pressed, focus-visible, disabled and loading states. Async operations show progress on the initiating control. Destructive actions continue to require confirmation and identity verification. Modals close by explicit close action, backdrop or Escape where safe; focus and back behavior must remain recoverable.

Touch targets are at least 44px on mobile. Inputs remain at least 16px on touch screens to avoid iOS zoom. Color is never the only status signal; labels and icons accompany status colors.

## Motion

Motion is short and functional: 160–260ms ease-out for buttons, drawers and dialogs; only opacity and transform are animated. No decorative continuous motion. Respect prefers-reduced-motion.

## Scope of this implementation pass

This pass updates the shell, dashboard surfaces, mobile navigation, drawer hierarchy, forms, tables and modal contrast. It does not alter API routes, role checks, report calculations, ordering logic, product templates or stored data.

## Slop audit

- Avoids the generic purple-gradient dashboard by using a restrained single accent over warm neutrals.
- Avoids card-everything by using surface groups, rules and compact rows.
- Keeps the navigation complete and visible through the full sidebar / bottom sheet.
- Keeps numbers left-anchored or right-aligned with tabular numerals where applicable.
- Provides high-contrast focus rings, touch targets and reduced-motion fallbacks.


## Mobile console v3

The mobile navigation uses an iOS-inspired floating dock: two labelled 54px actions, current page and full menu, inside a dark translucent capsule with safe-area spacing. Secondary navigation opens as a bottom sheet with a grab handle, large touch targets, contained scrolling, explicit close action and full role-aware navigation. The design borrows platform ergonomics, not another product's brand.
