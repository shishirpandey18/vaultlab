/*
 * VaultLab blog engine.
 * Reads posts.json (the list of posts), fetches each post's Markdown file,
 * converts it to HTML with marked, cleans it with DOMPurify, and highlights code.
 * Open the browser DevTools Console if something does not show up: every
 * failure is logged there with the exact file and reason.
 */
const Blog = (() => {
  // Settings live in assets/config.js, so updates to this file never overwrite them.
  const CONFIG = window.BLOG_CONFIG || {};
  const TOTAL_DAYS = CONFIG.totalDays || 30;
  const GITHUB_USER = CONFIG.githubUser || "YOUR-USERNAME";

  // Every "Code" link and any link containing YOUR-USERNAME gets the real username.
  function setRepoLinks() {
    if (GITHUB_USER === "YOUR-USERNAME") return;
    document.querySelectorAll("#repo-link").forEach(a => {
      a.href = `https://github.com/${GITHUB_USER}/vaultlab`;
    });
    document.querySelectorAll('a[href*="YOUR-USERNAME"]').forEach(a => {
      a.href = a.href.replace("YOUR-USERNAME", GITHUB_USER);
      if (a.textContent.includes("YOUR-USERNAME")) {
        a.textContent = a.textContent.replace("YOUR-USERNAME", GITHUB_USER);
      }
    });
  }

  // Load posts.json. "no-cache" asks the server whether the file changed,
  // so a freshly pushed post shows up without a hard refresh.
  async function loadPosts() {
    const res = await fetch("posts.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`posts.json returned HTTP ${res.status}`);
    let posts;
    try {
      posts = await res.json();
    } catch (e) {
      throw new Error(`posts.json is not valid JSON (${e.message})`);
    }
    return posts.sort((a, b) => b.day - a.day);
  }

  async function loadMarkdown(file) {
    const res = await fetch(file, { cache: "no-cache" });
    if (!res.ok) throw new Error(`${file} returned HTTP ${res.status}`);
    return res.text();
  }

  // Markdown -> HTML -> sanitised HTML. DOMPurify removes scripts and event
  // handlers, so a stray <script> in a post can never run on the site.
  function toSafeHtml(markdown) {
    const html = marked.parse(markdown);
    return DOMPurify.sanitize(html);
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function formatDate(iso) {
    const d = new Date(iso + "T12:00:00");
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text; // textContent never runs HTML
    return node;
  }

  function showError(where, err) {
    console.error("[blog]", err);
    where.hidden = false;
    where.classList.add("error");
    where.textContent = `Could not load: ${err.message}. Open DevTools → Console and Network for details.`;
  }

  // ---------- Home page ----------
  async function renderIndex() {
    setRepoLinks();
    const list = document.getElementById("post-list");
    const status = document.getElementById("status");
    list.classList.add("timeline"); // works even with an older index.html
    const search = document.getElementById("search");

    let posts;
    try {
      posts = await loadPosts();
    } catch (err) {
      document.getElementById("progress-text").textContent = "Progress unavailable";
      return showError(status, err);
    }

    const done = posts.length ? Math.max(...posts.map(p => p.day)) : 0;
    document.getElementById("progress-text").textContent = `Day ${done} of ${TOTAL_DAYS}`;
    document.getElementById("progress-fill").style.width = `${(done / TOTAL_DAYS) * 100}%`;

    // The home page reads like a story: Day 1 at the top.
    const chronological = posts.slice().sort((a, b) => a.day - b.day);

    function draw(filter) {
      list.replaceChildren();
      const q = filter.trim().toLowerCase();
      const shown = chronological.filter(p =>
        !q ||
        p.title.toLowerCase().includes(q) ||
        (p.summary || "").toLowerCase().includes(q) ||
        (p.tags || []).some(t => t.toLowerCase().includes(q))
      );

      shown.forEach((p, i) => {
        // 1st card left, 2nd right, 3rd left... (CSS places them)
        const li = el("li", `post-card ${i % 2 === 0 ? "left" : "right"}`);
        const a = el("a", "post-link");
        a.href = `post.html?day=${p.day}`;

        const top = el("div", "post-top");
        top.append(el("span", "day-badge", `Day ${pad(p.day)}`), el("time", "post-date", formatDate(p.date)));
        a.append(top, el("h3", "post-title", p.title));
        if (p.summary) a.append(el("p", "post-summary", p.summary));

        if (p.tags && p.tags.length) {
          const tags = el("div", "tags");
          p.tags.forEach(t => tags.append(el("span", "tag", t)));
          a.append(tags);
        }
        li.append(a);
        list.append(li);
      });

      status.hidden = shown.length > 0;
      status.classList.remove("error");
      if (!shown.length) status.textContent = posts.length ? "No posts match your search." : "No posts yet.";
    }

    draw("");
    search.addEventListener("input", () => draw(search.value));
  }

  // ---------- Single post ----------
  async function renderPost() {
    setRepoLinks();
    const article = document.getElementById("post");
    const meta = document.getElementById("post-meta");
    const pager = document.getElementById("pager");
    const day = Number(new URLSearchParams(location.search).get("day"));

    try {
      const posts = await loadPosts();
      const post = posts.find(p => p.day === day);
      if (!post) throw new Error(`no entry for day ${day} in posts.json`);

      const markdown = await loadMarkdown(post.file);
      article.innerHTML = toSafeHtml(markdown);
      setRepoLinks();
      document.title = `Day ${pad(post.day)}: ${post.title} · VaultLab`;

      meta.append(el("span", "day-badge", `Day ${pad(post.day)}`), el("time", "post-date", formatDate(post.date)));
      (post.tags || []).forEach(t => meta.append(el("span", "tag", t)));

      article.querySelectorAll("pre code").forEach(block => hljs.highlightElement(block));
      addCopyButtons(article);

      // Previous / next links (posts are sorted newest first)
      const i = posts.indexOf(post);
      const older = posts[i + 1], newer = posts[i - 1];
      if (older) pager.append(pagerLink(older, "← Previous", "prev"));
      if (newer) pager.append(pagerLink(newer, "Next →", "next"));
    } catch (err) {
      article.replaceChildren();
      const p = el("p", "status");
      article.append(p);
      showError(p, err);
    }
  }

  function pagerLink(p, label, cls) {
    const a = el("a", `pager-link ${cls}`);
    a.href = `post.html?day=${p.day}`;
    a.append(el("span", "pager-label", label), el("span", "pager-title", `Day ${pad(p.day)}: ${p.title}`));
    return a;
  }

  function addCopyButtons(root) {
    root.querySelectorAll("pre").forEach(pre => {
      const btn = el("button", "copy", "Copy");
      btn.type = "button";
      btn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(pre.querySelector("code")?.innerText || pre.innerText);
          btn.textContent = "Copied";
        } catch {
          btn.textContent = "Press Ctrl+C";
        }
        setTimeout(() => (btn.textContent = "Copy"), 1500);
      });
      pre.append(btn);
    });
  }

  // ---------- Plain page (About) ----------
  async function renderPage(file) {
    setRepoLinks();
    const article = document.getElementById("post");
    try {
      article.innerHTML = toSafeHtml(await loadMarkdown(file));
      setRepoLinks(); // About page links written as YOUR-USERNAME get the real name
      article.querySelectorAll("pre code").forEach(block => hljs.highlightElement(block));
    } catch (err) {
      article.replaceChildren();
      const p = el("p", "status");
      article.append(p);
      showError(p, err);
    }
  }

  return { renderIndex, renderPost, renderPage };
})();
