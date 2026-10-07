import "./globals.css";

export const metadata = { title: "mall 压测看板" };

export default function RootLayout({ children }) {
  return (
    <html lang="zh">
      <body>{children}</body>
    </html>
  );
}
