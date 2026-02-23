import React, { useState, useEffect, useRef } from 'react';

function App() {
  const [messages, setMessages] = useState<{role: string, content: string}[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("connecting");
  const socket = useRef<WebSocket | null>(null);

  useEffect(() => {
    const host = window.location.hostname === "localhost"
      ? "localhost:8787"
      : "edge-ai-backend.your-subdomain.workers.dev";
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";

    socket.current = new WebSocket(`${protocol}//${host}/agents/my-agent/default`);

    socket.current.onopen = () => setStatus("connected");
    socket.current.onclose = () => setStatus("disconnected");
    socket.current.onerror = () => setStatus("error");

    socket.current.onmessage = (event) => {
      if (typeof event.data === "string" && event.data.startsWith("cf_agent_state:")) {
        return;
      }

      try {
        const data = JSON.parse(event.data);
        if (data.text) {
          const role = data.type === "system" ? "system" : "assistant";
          setMessages(prev => [...prev, { role, content: data.text }]);
        }
      } catch {
        if (typeof event.data === "string") {
          setMessages(prev => [...prev, { role: "assistant", content: event.data }]);
        }
      }
    };

    return () => socket.current?.close();
  }, []);

  const handleSend = () => {
    if (socket.current?.readyState === WebSocket.OPEN && input) {
      socket.current.send(JSON.stringify({ type: "chat", text: input }));
      setMessages(prev => [...prev, { role: 'user', content: input }]);
      setInput("");
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto' }}>
      <h1>Cloudflare AI Agent</h1>
      <p style={{ marginTop: 0, color: '#666' }}>Status: {status}</p>
      <div style={{ height: '400px', overflowY: 'auto', border: '1px solid #ccc', marginBottom: '10px', padding: '10px' }}>
        {messages.map((m, i) => (
          <div key={i} style={{ textAlign: m.role === 'user' ? 'right' : 'left' }}>
            <p><strong>{m.role}:</strong> {m.content}</p>
          </div>
        ))}
      </div>
      <input 
        value={input} 
        onChange={(e) => setInput(e.target.value)} 
        onKeyDown={(e) => e.key === 'Enter' && handleSend()}
        placeholder="Type a message..."
        style={{ width: '80%', padding: '10px' }}
      />
      <button onClick={handleSend} style={{ width: '18%', padding: '10px', marginLeft: '2%' }}>Send</button>
    </div>
  );
}

export default App;
