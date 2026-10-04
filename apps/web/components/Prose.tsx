import Markdown from "react-markdown";

/** Markdown rendered without raw HTML (NFR-9). */
export function Prose({ children }: { children: string }) {
  return (
    <div className="flex flex-col gap-3 text-[17px] leading-[1.5] [&_a]:font-bold [&_a]:text-primary [&_h2]:font-display [&_h2]:text-2xl [&_h2]:font-bold [&_h3]:mt-3 [&_h3]:font-display [&_h3]:text-xl [&_h3]:font-bold [&_ul]:list-disc [&_ul]:pl-6">
      <Markdown skipHtml>{children}</Markdown>
    </div>
  );
}
