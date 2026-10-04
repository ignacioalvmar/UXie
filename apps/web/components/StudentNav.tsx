"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChatIcon, LibraryIcon, UserIcon } from "./icons";

/** Main navigation (library handoff §2 top bar, §6 bottom tab bar below 1024 px). */
const ITEMS = [
  { href: "/", label: "Library", short: "Library", Icon: LibraryIcon },
  { href: "/conversations", label: "My conversations", short: "Conversations", Icon: ChatIcon },
] as const;

const isCurrent = (path: string, href: string) =>
  href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);

export function TopNav({ isInstructor }: { isInstructor: boolean }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="hidden flex-1 flex-wrap gap-1 lg:flex">
      {ITEMS.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          aria-current={isCurrent(path, href) ? "page" : undefined}
          className={`inline-flex min-h-11 items-center rounded-[10px] px-4 font-bold ${
            isCurrent(path, href) ? "bg-panel text-primary-hover" : "text-ink-muted hover:bg-ground"
          }`}
        >
          {label}
        </Link>
      ))}
      {isInstructor && (
        <Link
          href="/admin"
          className="inline-flex min-h-11 items-center rounded-[10px] px-4 font-bold text-ink-muted hover:bg-ground"
        >
          Admin
        </Link>
      )}
    </nav>
  );
}

export function AccountLink() {
  const path = usePathname();
  const current = isCurrent(path, "/account");
  return (
    <Link
      href="/account"
      aria-current={current ? "page" : undefined}
      className="hidden min-h-11 items-center gap-2.5 font-bold text-ink lg:inline-flex"
    >
      <span className="inline-flex size-9 items-center justify-center rounded-full bg-panel text-primary-hover">
        <UserIcon size={20} />
      </span>
      Account
    </Link>
  );
}

export function BottomTabs() {
  const path = usePathname();
  const items = [
    ...ITEMS,
    { href: "/account", label: "Account", short: "Account", Icon: UserIcon },
  ];
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line-soft bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="mx-auto flex max-w-xl">
        {items.map(({ href, short, Icon }) => {
          const current = isCurrent(path, href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={current ? "page" : undefined}
                className={`flex min-h-[52px] flex-col items-center justify-center gap-0.5 py-1.5 text-[13px] font-bold ${
                  current ? "text-primary-hover" : "text-ink-muted"
                }`}
              >
                <Icon size={22} />
                {short}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
