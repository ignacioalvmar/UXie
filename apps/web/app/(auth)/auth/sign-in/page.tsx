import type { Metadata } from "next";
import {
  AuthFooter,
  BrandMark,
  CharacterLine,
  CharacterTrio,
  SpeechBubble,
} from "../../../../components/auth/parts";
import { firstDomain, redirectIfSignedIn } from "../guard";
import { SignInForm } from "./SignInForm";

export const metadata: Metadata = { title: "Sign in" };

/** HANDOFF §6.1: split layout from 1024 px, stacked below. */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; email?: string }>;
}) {
  await redirectIfSignedIn();
  const { next, email } = await searchParams;
  const domain = firstDomain();

  return (
    <div
      className="force-light flex min-h-dvh flex-col bg-ground lg:flex-row"
      style={{ colorScheme: "light" }}
    >
      {/* Wide screens: character panel */}
      <section
        aria-label="About UXie"
        className="hidden flex-[1_1_560px] flex-col justify-between bg-panel px-16 pt-14 lg:flex"
      >
        <BrandMark size="lg" />
        <div className="max-w-[560px]">
          <p className="font-display text-[60px] font-bold leading-[1.02] tracking-[-0.03em] text-ink">
            Dense papers, one good question at a time.
          </p>
          <p className="mt-6 text-xl leading-normal text-ink-muted">
            Pip, Miso and Luma help you work through UX research by asking, not telling.
          </p>
        </div>
        <div className="flex flex-col items-center gap-3">
          <SpeechBubble className="self-start">
            What made that interface feel easy to use?
          </SpeechBubble>
          <CharacterTrio size={240} />
        </div>
      </section>

      {/* Narrow screens: header sheet */}
      <section
        aria-label="About UXie"
        className="relative flex h-[272px] flex-col justify-between overflow-hidden rounded-b-[var(--radius-sheet)] bg-panel px-6 pt-6 lg:hidden"
      >
        <div className="flex items-start justify-between gap-4">
          <BrandMark />
          <SpeechBubble from="right" className="max-w-[60%] text-base">
            Ready for another good question?
          </SpeechBubble>
        </div>
        <CharacterTrio size={140} className="-mb-1" />
      </section>

      <main
        id="main"
        className="flex flex-[1_1_480px] flex-col items-center justify-center px-6 py-8"
      >
        <div className="flex w-full max-w-[420px] flex-col gap-6 text-ink">
          <div>
            <h1 className="font-display text-[32px] font-bold leading-[1.1] tracking-[-0.02em] lg:text-[40px]">
              Sign in
            </h1>
            <p className="mt-2 text-[17px] text-ink-muted lg:text-lg">
              <span className="lg:hidden">Pick up your papers where you left them.</span>
              <span className="hidden lg:inline">
                Your papers and conversations are where you left them.
              </span>
            </p>
          </div>
          <div className="hidden lg:block">
            <CharacterLine character="miso">
              Welcome back. Which paper are we questioning today?
            </CharacterLine>
          </div>
          <SignInForm domain={domain} next={next} email={email} />
          <AuthFooter />
        </div>
      </main>
    </div>
  );
}
