// app/layout.js
import './globals.css';

export const metadata = {
  title: 'IPM Budget System',
  description: 'Budget & Payment Request System',
};

export default function RootLayout({ children }) {
  return (
    <html lang="fa" dir="rtl">
      <body className="font-vazirmatn bg-neutral-950 text-neutral-100">
        {children}
      </body>
    </html>
  );
}
