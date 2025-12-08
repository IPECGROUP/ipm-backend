'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/', label: 'داشبورد' },
  { href: '/payment-requests', label: 'درخواست پرداخت' },
  { href: '/projects', label: 'پروژه‌ها' },
  { href: '/contracts', label: 'قراردادها' },
  { href: '/units', label: 'واحدها' },
  { href: '/budget-centers', label: 'مراکز بودجه' },
  { href: '/budget-estimates', label: 'برآوردها' },
  { href: '/budget-allocations', label: 'تخصیص بودجه' },
  { href: '/users', label: 'کاربران' },
];

export default function Shell({ children }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen flex bg-neutral-50 text-neutral-900">
      {/* نوار کناری راست */}
      <aside className="w-64 border-l border-neutral-200 bg-white/90 backdrop-blur-xl flex flex-col">
        <div className="h-16 flex items-center justify-center border-b border-neutral-200 text-sm font-semibold">
          سامانه مدیریت IPM
        </div>

        <nav className="flex-1 overflow-y-auto py-3">
          <ul className="space-y-1 px-3">
            {navItems.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={
                      'flex items-center justify-between rounded-xl px-3 py-2 text-sm transition ' +
                      (active
                        ? 'bg-orange-500/10 text-orange-600 border border-orange-400/50'
                        : 'text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 border border-transparent')
                    }
                  >
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>

      {/* محتوای اصلی */}
      <div className="flex-1 flex flex-col">
        {/* نوار بالا */}
        <header className="h-14 border-b border-neutral-200 bg-gradient-to-l from-white to-neutral-50 flex items-center justify-between px-6">
          <div className="text-xs text-neutral-500">
            ایده پویان انرژی › داشبورد
          </div>
          <div className="flex items-center gap-3 text-xs text-neutral-600">
            <span className="px-3 py-1 rounded-full bg-neutral-100 border border-neutral-200">
              کاربر فعلی
            </span>
          </div>
        </header>

        {/* بدنهٔ صفحه */}
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
