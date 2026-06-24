import React, { useState, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import { Check, Copy } from "lucide-react";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css";

/**
 * Recursively extract plain text from React children.
 * This handles the case where rehype-highlight transforms code content
 * into nested React elements (spans with syntax highlighting classes).
 */
function extractTextFromChildren(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (children == null || typeof children === "boolean") return "";

  if (Array.isArray(children)) {
    return children.map(extractTextFromChildren).join("");
  }

  // React element — extract text from its children prop
  if (typeof children === "object" && "props" in children) {
    return extractTextFromChildren(
      (children as React.ReactElement<{ children?: ReactNode }>).props.children
    );
  }

  return "";
}

interface MarkdownProps {
  content: string;
}

export const Markdown: React.FC<MarkdownProps> = ({ content }) => {
  return (
    <div className="prose max-w-none text-slate-200">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeHighlight, rehypeKatex]}
        components={{
          pre: ({ children, ...props }) => {
            return <pre className="p-0 bg-transparent m-0" {...props}>{children}</pre>;
          },
          code: ({ className, children, ...props }) => {
            const isBlock = className && className.includes("language-");
            const match = /language-(\w+)/.exec(className || "");
            const lang = match ? match[1] : "";

            if (isBlock) {
              // Extract plain text for the copy button
              const plainText = extractTextFromChildren(children).replace(/\n$/, "");
              return (
                <CodeBlock lang={lang || "code"} copyText={plainText}>
                  {children}
                </CodeBlock>
              );
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

interface CodeBlockProps {
  lang: string;
  copyText: string;
  children: ReactNode;
}

const CodeBlock: React.FC<CodeBlockProps> = ({ lang, copyText, children }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy code block content", err);
    }
  };

  return (
    <div className="my-4 border border-slate-800 rounded-lg overflow-hidden bg-slate-950/60 backdrop-blur-md">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900/80 border-b border-slate-800 text-xs text-slate-400 font-mono select-none">
        <span>{lang.toUpperCase()}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 hover:text-indigo-400 transition-colors cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-400 font-medium">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <div className="p-4 overflow-x-auto font-mono text-sm leading-relaxed text-slate-100">
        <code>{children}</code>
      </div>
    </div>
  );
};
