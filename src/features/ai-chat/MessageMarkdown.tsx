import ReactMarkdown from "react-markdown";

export type MessageMarkdownProps = {
  content: string;
};

export function MessageMarkdown({ content }: MessageMarkdownProps) {
  return (
    <div className="message-markdown">
      <ReactMarkdown
        components={{
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
