/**
 * UI theme, carried over from golf-report v1 (see docs/ui-theme.md).
 * Keep colors here so TSX, CSS (styles/theme.css) and Recharts stay in sync.
 */
import type { ThemeConfig } from "antd";

export const colors = {
  primary: "#1769aa",
  primaryHover: "#2367a4",
  success: "#1d9b6c",
  warning: "#db9b2b",
  error: "#d95757",

  /** Navy scale, darkest first: text, sidebar. */
  navy900: "#102a43",
  navy800: "#243b53",
  navy700: "#334e68",
  navy600: "#486581",
  navy500: "#526b83",
  navy400: "#627d98",
  navy300: "#829ab1",
  border: "#dce5ed",
  borderSoft: "#e6edf3",
  pageBg: "#f4f7fa",
  surfaceMuted: "#f7fafc",

  okText: "#167451",
  okBg: "#eefaf3",
  okBorder: "#b8e4cd",
  okSolid: "#19764d",
  ngText: "#bc3030",
  ngBg: "#fff1f0",
  ngBorder: "#f0c2c2",
  ngSolid: "#ba3938",

  /** Bend limit lines / exceeded markers. */
  limit: "#d92d20",
} as const;

/** Line colors for measuring points P1..P4. */
export const pointColors = ["#1769aa", "#ed8b47", "#1d9b6c", "#d4a82c"] as const;

export const fonts = {
  body: '"DM Sans", "Segoe UI", sans-serif',
  display: '"Space Grotesk", "DM Sans", "Segoe UI", sans-serif',
} as const;

export const antdTheme: ThemeConfig = {
  token: {
    colorPrimary: colors.primary,
    colorInfo: colors.primary,
    colorSuccess: colors.success,
    colorWarning: colors.warning,
    colorError: colors.error,
    borderRadius: 10,
    fontFamily: fonts.body,
  },
  components: {
    Layout: { siderBg: colors.navy900, headerBg: "#ffffff", bodyBg: colors.pageBg },
    Menu: { darkItemBg: colors.navy900, darkItemSelectedBg: colors.primaryHover },
    Table: { headerBg: "#f5f8fb", headerColor: colors.navy600 },
  },
};
