import { UxieCharacter } from "@uxie/character";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-6 px-4 text-center">
      <UxieCharacter character="pip" state="idle" size={140} />
      <h1 className="text-3xl font-semibold tracking-tight">UXie</h1>
      <p className="text-[var(--muted)]">
        A Socratic study companion for reading UX research papers. Coming soon for the WS 26/27
        pilot.
      </p>
    </main>
  );
}
