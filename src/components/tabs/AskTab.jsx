import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './AskTab.css';

// wide tables scroll sideways inside their own box
const mdComponents = {
  table: ({ children }) => <div className="ask-table-wrap"><table>{children}</table></div>,
};

export default function AskTab({ result, loading, error }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  async function send() {
    const q = input.trim();
    if (!q || thinking) return;

    const history = messages
      .filter(m => !m.isError)
      .slice(-5)
      .map(m => ({ role: m.role, content: m.content }));

    setMessages(prev => [...prev, { role: 'user', content: q }]);
    setInput('');
    setThinking(true);

    try {
      const res = await fetch('http://localhost:5000/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, history, analysisId: result.analysisId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      setMessages(prev => [...prev, { role: 'assistant', content: data.answer }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}`, isError: true }]);
    } finally {
      setThinking(false);
    }
  }

  if (loading) return <div className="ask-empty">Analyzing…</div>;
  if (error) return <div className="ask-empty">{error}</div>;
  if (!result) return <div className="ask-empty">Analyze a repo first, then ask about it.</div>;

  return (
    <div className="ask-wrap">
      <div className="ask-messages">
        {messages.length === 0 && (
          <div className="ask-empty">Ask about a file or function, e.g. "What does parser.js do?"</div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`ask-msg ask-${m.role}`}>
            {m.role === 'assistant' && !m.isError ? (
              <div className="ask-md">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                  {m.content}
                </ReactMarkdown>
              </div>
            ) : (
              m.content
            )}
          </div>
        ))}
        {thinking && (
          <div className="ask-msg ask-assistant ask-dots">
            <span></span><span></span><span></span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="ask-inputrow">
        <input
          className="ask-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="Ask about this repo…"
        />
        <button className="ask-send" onClick={send} disabled={thinking}>Send</button>
      </div>
    </div>
  );
}