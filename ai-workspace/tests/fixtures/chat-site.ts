import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A tiny fake AI chat web UI: an input (textarea or contenteditable), a send button, an answer
 * that streams in word by word while a stop button is visible, and source links at the end.
 */
function page(editable: boolean): string {
  const input = editable ? '<div id="q" contenteditable="true" style="min-height:40px;border:1px solid #ccc"></div>' : '<textarea id="q"></textarea>';
  return `<!doctype html><html><body>
<div id="thread"></div>${input}<button id="send">Send</button>
<script>
window.stopped = false;
const q = document.getElementById("q");
const read = () => (q.value !== undefined ? q.value : q.innerText).trim();
document.getElementById("send").onclick = () => {
  const prompt = read();
  const lastLine = prompt.trim().split("\\n").pop();
  const words = ("Antwoord op: " + lastLine + ". Ik ontving " + prompt.replace(/\\s+/g, "").length + " tekens. " + "Dit is een gestreamd antwoord met meerdere woorden.").split(" ");
  const answer = document.createElement("div");
  answer.className = "answer";
  const p = document.createElement("p");
  answer.appendChild(p);
  document.getElementById("thread").appendChild(answer);
  const stop = document.createElement("button");
  stop.id = "stop"; stop.textContent = "Stop";
  document.body.appendChild(stop);
  let i = 0;
  const timer = setInterval(() => {
    if (i < words.length) { p.textContent += (i ? " " : "") + words[i++]; return; }
    clearInterval(timer);
    answer.insertAdjacentHTML("beforeend", '<div class="sources"><a href="https://example.org/bron-1">Bron 1</a> <a href="https://example.org/bron-2">Bron 2</a> <a href="https://example.org/bron-1">Bron 1 dubbel</a></div>');
    stop.remove();
  }, 100);
  stop.onclick = () => { window.stopped = true; clearInterval(timer); stop.remove(); };
  history.pushState({}, "", "/thread/" + Date.now());
};
</script></body></html>`;
}

export async function startFixtureSite(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (req.url?.startsWith("/login")) return res.end("<!doctype html><html><body><h1>Log in</h1></body></html>");
    res.end(page(req.url?.startsWith("/ce") ?? false));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) };
}

export const fixtureSelectors = {
  input: "#q",
  submit: "#send",
  response: ".answer",
  generating: "#stop",
  citations: "a[href^='http']",
  maxPromptChars: 50_000,
  stableMs: 300,
};
