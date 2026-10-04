import type { ReactNode } from "react";
import { UxieCharacter } from "@uxie/character";
import { BrandMark } from "../../components/auth/parts";
import { AccountLink, BottomTabs, TopNav } from "../../components/StudentNav";
import { requireUser } from "../../lib/auth";

/** App shell for signed-in, verified, onboarded users (FR-1.2, FR-1.3; library handoff §2, §6). */
export default async function StudentLayout({ children }: { children: ReactNode }) {
  const { profile } = await requireUser();
  return (
    <div
      className="force-light flex min-h-dvh flex-col bg-ground text-ink"
      style={{ colorScheme: "light" }}
    >
      <header className="border-b-[1.5px] border-line-soft bg-surface">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-7 px-4 py-3 lg:px-8">
          <BrandMark href="/" />
          <TopNav isInstructor={profile.role === "instructor"} />
          <AccountLink />
          {profile.uxieCharacter && (
            <span className="ml-auto lg:hidden">
              <UxieCharacter character={profile.uxieCharacter} size={40} decorative />
            </span>
          )}
        </div>
      </header>
      <main
        id="main"
        className="mx-auto w-full max-w-[1280px] flex-1 px-4 pb-28 pt-6 lg:px-8 lg:pb-20 lg:pt-10"
      >
        {children}
      </main>
      <BottomTabs />
    </div>
  );
}
