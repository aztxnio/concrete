// Workspace behaviour: selecting concretes, the canvas, the add and edit forms,
// undo/redo, saving to the browser and publishing to GitHub. Plain JavaScript
// with no build step; the starting data is in data.js.

(() => {
  "use strict";

  const GRID = 20; // matches --grid in styles.css
  const HISTORY_LIMIT = 200;
  const STORAGE_KEY = "concrete-workspace";
  const PUBLISH_STORAGE_KEY = "concrete-publish"; // the GitHub project and key, kept apart from the data
  const ICON_SIZE = 160; // icons are stored as squares this many pixels wide, sharp in the big bubbles
  const KINDS = ["concretes", "ingredients"];
  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 3;
  const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3]; // where the + and - buttons stop
  const DRAG_TYPE = "application/x-concrete-item";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const NUDGES = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const ICONS = { plus: "M8 3v10M3 8h10", cross: "M4.5 4.5l7 7M11.5 4.5l-7 7", back: "M10 3.5 5.5 8l4.5 4.5" };
  const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const els = {
    concreteDraft: $("#concrete-draft"),
    concretePage: $("#concrete-page"),
    concreteList: $("#concrete-list"),
    ingredientDraft: $("#ingredient-draft"),
    ingredientPage: $("#ingredient-page"),
    ingredientList: $("#ingredient-list"),
    workspace: $("#workspace"),
    paper: $("#paper"),
    sheet: $("#sheet"),
    cards: $("#cards"),
    emptyHint: $("#empty-hint"),
    toast: $("#toast"),
    toolbar: $("#toolbar"),
    addConcrete: $("#add-concrete"),
    addIngredient: $("#add-ingredient"),
    clear: $("#clear-canvas"),
    undo: $("#undo"),
    redo: $("#redo"),
    publish: $("#publish"),
    publishLabel: $("#publish-label"),
    publishCount: $("#publish-count"),
    publishDraft: $("#publish-draft"),
    zoom: $("#zoom"),
    zoomOut: $("#zoom-out"),
    zoomLevel: $("#zoom-level"),
    zoomIn: $("#zoom-in"),
  };

  const panels = {
    concretes: { page: els.concretePage, list: els.concreteList, filter: $("#concrete-filter") },
    ingredients: { page: els.ingredientPage, list: els.ingredientList, filter: $("#ingredient-filter") },
  };

  const seed = { concretes: SEED.concretes ?? [], ingredients: SEED.ingredients ?? [] };

  // ---------------------------------------------------------------------------
  // State
  //
  // `doc` holds everything undo/redo covers and everything that gets saved.
  // `ui` is view state that isn't: what's selected or open, and the forms.

  const stored = readSaved();
  let doc = load(stored);

  // Changes that are on GitHub already but not yet in the data.js this page
  // loaded, since GitHub takes a few minutes to update the site. Keys are
  // keyOf() an item; values are its fingerprint, or "removed".
  let published = publishedIn(stored);

  const history = { past: [], future: [], lastTag: null, lastAt: 0 };

  const ui = {
    selectedId: null,
    openIngredients: new Set(),
    // The forms. `editing` is the id of the item being edited, or null for a new one.
    concreteDraft: null, // { editing, name, description, notes, tags, icon, picked: Set of ingredient ids, error }
    ingredientDraft: null, // { editing, name, description, notes, tags, icon, group, error }
    publishDraft: null, // { project, key, error }
    publishing: false,
    // The item each panel is showing as a page, from See more, and where its
    // list was scrolled to before.
    page: { concretes: null, ingredients: null },
    pageScroll: { concretes: 0, ingredients: 0 },
    // What each list is narrowed down to. `tags` holds them in lowercase.
    filters: {
      concretes: { text: "", tags: new Set() },
      ingredients: { text: "", tags: new Set() },
    },
    zoom: 1,
  };

  let cardCount = highestCardNumber();

  const findConcrete = (id) => doc.concretes.find((c) => c.id === id);
  const findIngredient = (id) => doc.ingredients.find((i) => i.id === id);
  const findItem = (kind, id) => doc[kind].find((x) => x.id === id);
  const singular = (kind) => kind.slice(0, -1); // "concretes" → "concrete", as rows and cards name it
  const findCard = (id) => doc.canvas.find((c) => c.id === id);
  const cardNode = (id) => $(`.card[data-id="${CSS.escape(id)}"]`, els.sheet);
  const ingredientsOf = (concrete) => concrete.ingredients.map(findIngredient).filter(Boolean);
  const pickedIds = (draft) => doc.ingredients.filter((i) => draft.picked.has(i.id)).map((i) => i.id);
  const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const tagsOf = (item) => (Array.isArray(item?.tags) ? item.tags.map(String) : []);
  const snap = (n) => Math.max(0, Math.round(n / GRID) * GRID);
  const scrollBehavior = () => (reducedMotion.matches ? "auto" : "smooth");
  const isEnabled = (button) => button.getAttribute("aria-disabled") !== "true";

  // ---------------------------------------------------------------------------
  // Saving
  //
  // data.js is the shared starting point. Each browser saves only how it
  // differs from that (new, edited and deleted items) plus the canvas, so
  // later changes to data.js still reach everyone. Publishing is how those
  // differences get into data.js.

  const seedById = {
    concretes: new Map(seed.concretes.map((c) => [c.id, c])),
    ingredients: new Map(seed.ingredients.map((i) => [i.id, i])),
  };
  const keyOf = (kind, id) => `${kind === "concretes" ? "c" : "i"}:${id}`;

  // How a doc differs from data.js: items that are new or edited, and the ids
  // of ones deleted. Anything published but not yet in this page's copy of
  // data.js counts as being there, so deleting it takes it off GitHub too.
  function changes(d) {
    const result = { concretes: [], ingredients: [], removed: { concretes: [], ingredients: [] } };
    for (const kind of KINDS) {
      const originals = seedById[kind];
      result[kind] = d[kind].filter((item) => {
        const original = originals.get(item.id);
        return !original || fingerprint(original) !== fingerprint(item);
      });
      const there = new Set(originals.keys());
      for (const [key, print] of published) {
        if (key.startsWith(keyOf(kind, "")) && print !== "removed") there.add(key.slice(2));
      }
      const present = new Set(d[kind].map((item) => item.id));
      result.removed[kind] = [...there].filter((id) => !present.has(id));
    }
    return result;
  }

  // How many of those haven't been published. The Publish button shows this.
  function unpublishedCount(d) {
    const changed = changes(d);
    let count = 0;
    for (const kind of KINDS) {
      count += changed[kind].filter((item) => published.get(keyOf(kind, item.id)) !== fingerprint(item)).length;
      count += changed.removed[kind].filter((id) => published.get(keyOf(kind, id)) !== "removed").length;
    }
    return count;
  }

  // A short stand-in for an item's contents, to tell when it's changed. Items
  // are never changed in place, so each one's is only worked out once.
  const fingerprints = new WeakMap();

  function fingerprint(item) {
    let print = fingerprints.get(item);
    if (print === undefined) {
      const text = JSON.stringify(item);
      let hash = 2166136261;
      for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
      print = `${(hash >>> 0).toString(36)}.${text.length.toString(36)}`;
      fingerprints.set(item, print);
    }
    return print;
  }

  function readSaved() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return saved?.version === 1 ? saved : null;
    } catch {
      // Storage is blocked or unreadable, so start from data.js alone.
      return null;
    }
  }

  function load(saved) {
    const lists = {
      concretes: structuredClone(seed.concretes),
      ingredients: structuredClone(seed.ingredients),
    };
    if (!saved) return { ...lists, canvas: [] };

    // Saved items take the place of data.js ones with the same id, or join
    // the end, and deleted ones come out.
    for (const kind of KINDS) {
      for (const item of saved[kind] ?? []) {
        if (!item?.id) continue;
        const at = lists[kind].findIndex((x) => x.id === item.id);
        if (at === -1) lists[kind].push(item);
        else lists[kind][at] = item;
      }
      const gone = new Set(Array.isArray(saved.removed?.[kind]) ? saved.removed[kind] : []);
      lists[kind] = lists[kind].filter((item) => !gone.has(item.id));
    }
    const exists = (card) => lists[card.kind === "concrete" ? "concretes" : "ingredients"].some((x) => x.id === card.ref);
    return { ...lists, canvas: (saved.canvas ?? []).filter(exists) };
  }

  function publishedIn(saved) {
    return new Map(Object.entries(saved?.published ?? {}).filter(([, print]) => typeof print === "string"));
  }

  let saveFailed = false;

  function save() {
    const changed = changes(doc);
    // What's been published only needs remembering while it still differs from data.js.
    const pending = new Set();
    for (const kind of KINDS) {
      for (const item of changed[kind]) pending.add(keyOf(kind, item.id));
      for (const id of changed.removed[kind]) pending.add(keyOf(kind, id));
    }
    const data = {
      version: 1,
      concretes: changed.concretes,
      ingredients: changed.ingredients,
      removed: changed.removed,
      canvas: doc.canvas,
      published: Object.fromEntries([...published].filter(([key]) => pending.has(key))),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      saveFailed = false;
    } catch {
      if (!saveFailed) {
        showToast("Couldn't save in this browser, so changes will be lost on reload. Its storage may be full or turned off.");
      }
      saveFailed = true;
    }
  }

  function highestCardNumber() {
    return Math.max(0, ...doc.canvas.map((item) => Number(String(item.id).replace(/\D/g, "")) || 0));
  }

  // Another tab saved. Take its version so the two tabs don't overwrite each other.
  addEventListener("storage", (event) => {
    if (event.key === null || event.key === PUBLISH_STORAGE_KEY) settings = readSettings();
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    const saved = readSaved();
    doc = load(saved);
    published = publishedIn(saved);
    cardCount = Math.max(cardCount, highestCardNumber());
    history.past.length = 0;
    history.future.length = 0;
    render();
  });

  let toastTimer = 0;

  // A short message over the paper, with an optional button such as Undo.
  function showToast(message, action = null) {
    els.toast.hidden = false;
    els.toast.replaceChildren(message);
    if (action) {
      els.toast.append(" ", h("button", {
          type: "button",
          class: "toast-action",
          onclick: () => {
            els.toast.hidden = true;
            action.run();
          },
        },
        action.label));
    }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.hidden = true;
    }, 8000);
  }

  // A toast's Undo only means what it says until something else changes.
  function dropToastAction() {
    if ($(".toast-action", els.toast)) els.toast.hidden = true;
  }

  // ---------------------------------------------------------------------------
  // Publishing
  //
  // Publish sends what's been added, edited or deleted here to data.js in the
  // site's GitHub project, using a key from GitHub that's saved in this
  // browser. GitHub then updates the site for everyone. Without a key, the
  // Publish form offers data.js as a download to upload by hand instead.

  // The comment at the top of data.js, so a published or downloaded copy
  // explains itself too. Keep the two in step.
  const DATA_HEADER = [
    "// The concretes and ingredients everyone sees when they open the site.",
    "//",
    "// To change them, use Add and Edit on the page, then click Publish. Until",
    "// then, changes are only saved in the browser they were made in.",
    "//",
    "// This file can be edited by hand too, though publishing rewrites it and",
    "// drops any comments other than this one. Each concrete lists its",
    "// ingredients by id, so every id in a concrete's `ingredients` has to match",
    "// an ingredient below. The page warns in the browser console if one doesn't.",
    "//",
    "// `icon` is optional: a path to an image (for example \"icons/sand.png\") or an",
    "// image data URL. Without one, the item shows a plain circle.",
    "// `group` is optional too. Ingredients that share a group are listed together",
    "// under that heading.",
    "// `notes` is optional as well: the longer write-up on the item's own page,",
    "// which opens from See more.",
    "// `tags` is optional too: a list of words to search and filter by, like",
    "// [\"Structural\", \"Low carbon\"].",
  ];

  // { project: "owner/name", key } for this browser, or null before the first publish.
  let settings = readSettings();

  function readSettings() {
    try {
      return JSON.parse(localStorage.getItem(PUBLISH_STORAGE_KEY));
    } catch {
      return null;
    }
  }

  function writeSettings() {
    try {
      localStorage.setItem(PUBLISH_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Not remembered, so the form asks again after a reload.
    }
  }

  async function publish() {
    if (ui.publishing) return;
    if (!settings?.project || !settings?.key) {
      openPublishDraft();
      return;
    }
    const sending = changes(doc);
    ui.publishing = true;
    if (ui.publishDraft) ui.publishDraft.error = "";
    renderToolbar();
    paint();
    try {
      const updated = await sendToGitHub(settings, sending);
      for (const kind of KINDS) {
        for (const item of sending[kind]) published.set(keyOf(kind, item.id), fingerprint(item));
        for (const id of sending.removed[kind]) published.set(keyOf(kind, id), "removed");
      }
      // Undo can't take back what's on GitHub, so it starts afresh from here.
      history.past.length = 0;
      history.future.length = 0;
      dropToastAction();
      ui.publishDraft = null;
      save();
      showToast(updated
        ? "Published. Everyone will see it within a few minutes."
        : "GitHub already had all of that. Everyone will see it within a few minutes.");
    } catch (error) {
      if (error.reason === undefined) console.error(error);
      publishFailed(error.reason);
    }
    ui.publishing = false;
    render();
    // Publish goes away once there's nothing left to publish, so don't strand focus.
    if (document.activeElement === document.body) els.paper.focus({ preventScroll: true });
  }

  function publishFailed(reason) {
    const project = settings.project;
    if (reason === 401) {
      settings = { project, key: "" };
      writeSettings();
      openPublishDraft("GitHub didn't accept that key. It may have run out or been pasted wrong, so paste a new one.");
    } else if (reason === 403) {
      openPublishDraft(`That key can't change ${project}. It needs access to that project, with Contents set to Read and write.`);
    } else if (reason === 404) {
      openPublishDraft(`Couldn't find data.js in ${project}. Check the project name.`, "project");
    } else {
      const message = {
        offline: "Couldn't reach GitHub. Check the internet connection and try again.",
        limited: "GitHub has had too many requests from here. Try again in a few minutes.",
        unreadable: "data.js on GitHub couldn't be read, so nothing was published. A hand edit may have broken it.",
      }[reason] ?? "GitHub couldn't take the change just now. Try again in a minute.";
      if (ui.publishDraft) ui.publishDraft.error = message;
      else showToast(message);
    }
  }

  // The form is built afresh each time it opens, so it shows what's saved now.
  function openPublishDraft(error = "", focus = "key") {
    ui.publishDraft = { project: settings?.project || guessProject(), key: settings?.key ?? "", error };
    els.publishDraft.replaceChildren();
    render();
    const input = $(ui.publishDraft.project ? `#publish-${focus}` : "#publish-project");
    input.focus();
    input.select();
  }

  function closePublishDraft() {
    ui.publishDraft = null;
    render();
    els.publish.focus();
  }

  function savePublishDraft() {
    const draft = ui.publishDraft;
    if (ui.publishing) return;
    const project = parseProject(draft.project);
    const key = draft.key.trim();
    draft.error = !project
      ? "Enter the project as owner/name, like your-name/concrete-mixes."
      : !key ? "Paste the key from GitHub." : "";
    if (draft.error) {
      paint();
      $(project ? "#publish-key" : "#publish-project").focus();
      return;
    }
    settings = { project, key };
    writeSettings();
    publish();
  }

  function publishDraftForm(draft) {
    const project = textField("publish-project", draft, "project");
    const key = textField("publish-key", draft, "key");
    project.placeholder = "your-name/concrete-mixes";
    key.type = "password";
    key.placeholder = "github_pat_…";
    for (const input of [project, key]) {
      input.maxLength = 200;
      input.spellcheck = false;
    }
    return draftForm({
      title: "Publish to GitHub",
      fields: [field("GitHub project", project), field("Key", key)],
      saveLabel: "Publish",
      onSave: savePublishDraft,
      onCancel: closePublishDraft,
      extra: altButton("Download data.js instead", () => {
        closePublishDraft();
        downloadData();
      }),
    });
  }

  // On GitHub Pages the address gives the project away: owner.github.io/name/,
  // or just owner.github.io for the owner's main site.
  function guessProject() {
    const owner = location.hostname.match(/^([\w-]+)\.github\.io$/i)?.[1];
    if (!owner) return "";
    const path = location.pathname.split("/");
    return `${owner}/${path.length > 2 ? path[1] : `${owner}.github.io`}`;
  }

  // "owner/name", from either that or the project's GitHub address.
  function parseProject(text) {
    const [owner, name] = text.trim().replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "").split("/");
    const repo = name?.replace(/\.git$/i, "") ?? "";
    return /^[\w.-]+$/.test(owner) && /^[\w.-]+$/.test(repo) ? `${owner}/${repo}` : "";
  }

  // Makes the changes being sent to the data.js on GitHub, keeping anything
  // else that's changed there since this page loaded. False if GitHub already
  // had it all.
  async function sendToGitHub({ project, key }, sending) {
    for (let attempt = 1; ; attempt++) {
      const remote = await readFromGitHub(project, key);
      const lists = applyChanges(remote.seed, sending);
      const message = describeChanges(remote.seed, lists);
      if (!message) return false;
      try {
        await github(project, key, "contents/data.js", {
          method: "PUT",
          body: { message, content: toBase64(dataFile(lists)), sha: remote.sha },
        });
        return true;
      } catch (error) {
        // Someone else saved data.js in between, so start again from theirs.
        if (error.reason !== 409 || attempt === 3) throw error;
      }
    }
  }

  // GitHub's lists with edited items swapped in where they were, new ones at
  // the end, and deleted ones gone, including from any concrete that used them.
  function applyChanges(base, sending) {
    const apply = (list, changed, removed) => {
      const edits = new Map(changed.map((item) => [item.id, item]));
      const kept = list.filter((item) => !removed.includes(item.id)).map((item) => edits.get(item.id) ?? item);
      return [...kept, ...changed.filter((item) => !kept.some((x) => x.id === item.id))];
    };
    const gone = new Set(sending.removed.ingredients);
    const concretes = apply(base.concretes, sending.concretes, sending.removed.concretes).map((c) =>
      c.ingredients?.some((id) => gone.has(id)) ? { ...c, ingredients: c.ingredients.filter((id) => !gone.has(id)) } : c);
    return { concretes, ingredients: apply(base.ingredients, sending.ingredients, sending.removed.ingredients) };
  }

  // A commit message such as "Add Sand; Edit C30 mix; Delete Lime", or "" if
  // nothing differs.
  function describeChanges(before, after) {
    const added = [];
    const edited = [];
    const deleted = [];
    for (const kind of KINDS) {
      const old = new Map(before[kind].map((item) => [item.id, item]));
      const now = new Set(after[kind].map((item) => item.id));
      for (const item of after[kind]) {
        if (!old.has(item.id)) added.push(item.name);
        else if (JSON.stringify(old.get(item.id)) !== JSON.stringify(item)) edited.push(item.name);
      }
      for (const item of before[kind]) {
        if (!now.has(item.id)) deleted.push(item.name);
      }
    }
    const message = [["Add", added], ["Edit", edited], ["Delete", deleted]]
      .filter(([, names]) => names.length)
      .map(([verb, names]) => `${verb} ${names.join(", ")}`)
      .join("; ");
    const count = added.length + edited.length + deleted.length;
    return message.length <= 72 ? message : `Update ${count} things from the site`;
  }

  async function readFromGitHub(project, key) {
    const file = await github(project, key, "contents/data.js");
    // Files over 1 MB come without their content, so that's fetched on its own.
    const text = file.encoding === "base64"
      ? fromBase64(file.content)
      : await github(project, key, "contents/data.js", { raw: true });
    let seed = null;
    try {
      seed = new Function(`${text}\nreturn SEED;`)();
    } catch {
      // Reported just below.
    }
    if (!Array.isArray(seed?.concretes) || !Array.isArray(seed?.ingredients)) throw failure("unreadable");
    return { sha: file.sha, seed };
  }

  async function github(project, key, path, { method = "GET", body = null, raw = false } = {}) {
    let response;
    try {
      response = await fetch(`https://api.github.com/repos/${project}/${path}`, {
        method,
        // Check with GitHub every time rather than trusting a copy from a minute ago.
        cache: "no-cache",
        headers: {
          Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
          Authorization: `Bearer ${key}`,
          ...(body && { "Content-Type": "application/json" }),
        },
        body: body && JSON.stringify(body),
      });
    } catch {
      throw failure("offline");
    }
    if (!response.ok) {
      const limited = response.status === 429 || response.headers.get("x-ratelimit-remaining") === "0";
      throw failure(limited ? "limited" : response.status);
    }
    return raw ? response.text() : response.json();
  }

  function failure(reason) {
    return Object.assign(new Error(`Publishing failed: ${reason}`), { reason });
  }

  function downloadData() {
    const url = URL.createObjectURL(new Blob([dataFile(doc)], { type: "text/javascript" }));
    const link = h("a", { href: url, download: "data.js", hidden: true });
    document.body.append(link);
    link.click();
    link.remove();
    // Some browsers only read the file after click() returns, so let it go later.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    showToast("Downloaded data.js. Upload it in place of the site's old data.js and everyone will see your changes.");
  }

  // Laid out the way data.js is written by hand, so the two read the same and
  // comparing versions shows only what changed.
  function dataFile({ concretes, ingredients }) {
    return [
      ...DATA_HEADER,
      "",
      "const SEED = {",
      `  concretes: ${toSource(concretes, "  ")},`,
      "",
      `  ingredients: ${toSource(ingredients, "  ")},`,
      "};",
      "",
    ].join("\n");
  }

  // A value as JavaScript source: unquoted keys, a comma after every entry, and
  // lists of plain values kept on one line.
  function toSource(value, indent = "") {
    const inner = `${indent}  `;
    if (Array.isArray(value)) {
      if (value.every((v) => v === null || typeof v !== "object")) {
        return `[${value.map((v) => toSource(v)).join(", ")}]`;
      }
      return `[\n${value.map((v) => `${inner}${toSource(v, inner)},\n`).join("")}${indent}]`;
    }
    if (value !== null && typeof value === "object") {
      const key = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));
      const entries = Object.entries(value).filter(([, v]) => v !== undefined);
      return `{\n${entries.map(([k, v]) => `${inner}${key(k)}: ${toSource(v, inner)},\n`).join("")}${indent}}`;
    }
    return JSON.stringify(value) ?? "null";
  }

  // GitHub sends and takes file contents as base64 of the file's UTF-8 bytes.
  function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }

  function fromBase64(base64) {
    return new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
  }

  // ---------------------------------------------------------------------------
  // History

  // Concretes and ingredients are never changed in place (an edit swaps in a
  // new copy), so snapshots can share them, icons and all. Canvas items get
  // moved, so those are copied.
  function snapshot(d) {
    return {
      concretes: [...d.concretes],
      ingredients: [...d.ingredients],
      canvas: d.canvas.map((item) => ({ ...item })),
    };
  }

  // Every change to `doc` goes through commit() so it can be undone. Changes
  // with the same tag in quick succession (nudging a card with the arrow keys)
  // collapse into a single undo step.
  function commit(change, tag = null) {
    dropToastAction();
    const now = Date.now();
    const merge = tag !== null && tag === history.lastTag && now - history.lastAt < 1000;
    if (!merge) {
      history.past.push(snapshot(doc));
      if (history.past.length > HISTORY_LIMIT) history.past.shift();
    }
    history.future.length = 0;
    history.lastTag = tag;
    history.lastAt = now;
    change(doc);
    save();
    render();
  }

  function undo() {
    if (!history.past.length) return;
    dropToastAction();
    history.future.push(doc);
    doc = history.past.pop();
    history.lastTag = null;
    save();
    render();
  }

  function redo() {
    if (!history.future.length) return;
    dropToastAction();
    history.past.push(doc);
    doc = history.future.pop();
    history.lastTag = null;
    save();
    render();
  }

  // ---------------------------------------------------------------------------
  // Rendering
  //
  // render() rebuilds the lists and the canvas from `doc`. paint() only moves
  // the highlights around, so selecting things keeps focus and scroll intact.

  function render() {
    if (ui.selectedId && !findConcrete(ui.selectedId)) ui.selectedId = null;
    keepingFocus(() => {
      renderFilters();
      renderConcretes();
      renderIngredients();
      renderDrafts();
      renderPages();
      renderCanvas();
      renderToolbar();
      paint();
    });
  }

  // Rebuilding a list loses focus, so put it back on the same control afterwards.
  function keepingFocus(draw) {
    const focusKey = document.activeElement?.dataset?.focusKey;
    draw();
    if (focusKey) $(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
  }

  function renderConcretes() {
    els.concreteList.replaceChildren(
      ...doc.concretes.filter((c) => matchesFilter("concretes", c)).map((c) =>
        h("li", { class: "row", draggable: "true", "data-kind": "concrete", "data-id": c.id },
          h("button", { type: "button", class: "row-main", "aria-pressed": "false", "data-focus-key": `concrete:${c.id}` },
            bubble(c),
            h("span", { class: "row-name" }, c.name),
            c.description ? h("span", { class: "row-desc" }, c.description) : null,
            h("span", { class: "row-count" },
              String(ingredientsOf(c).length),
              h("span", { class: "sr-only" }, " ingredients"))),
          placeButton("concrete", c),
          rowTags("concretes", c),
          rowTools("concrete", c))));
  }

  function renderIngredients() {
    const picking = Boolean(ui.concreteDraft);
    els.ingredientList.classList.toggle("is-picking", picking);
    // Filtered within the groups, so that they stay in the same order.
    const groups = ingredientGroups()
      .map((group) => ({ ...group, items: group.items.filter((i) => matchesFilter("ingredients", i)) }))
      .filter((group) => group.items.length);
    els.ingredientList.replaceChildren(
      ...groups.map((group, index) => {
        const list = h("ul", { class: "list" }, group.items.map((i) => ingredientRow(i, picking)));
        if (!group.name) return list;
        return h("section", { class: "group", "aria-labelledby": `group-${index}` },
          h("h3", { class: "group-name", id: `group-${index}` }, group.name),
          list);
      }));
  }

  // Ingredients without a group come first, then each group in the order it
  // first appears. Group names match regardless of capitals.
  function ingredientGroups() {
    const groups = new Map([["", { name: "", items: [] }]]);
    for (const ingredient of doc.ingredients) {
      const name = ingredient.group?.trim() ?? "";
      const key = name.toLowerCase();
      if (!groups.has(key)) groups.set(key, { name, items: [] });
      groups.get(key).items.push(ingredient);
    }
    return [...groups.values()].filter((g) => g.items.length);
  }

  // While a concrete is being made or edited, ingredient rows are tick boxes.
  // Otherwise clicking one opens it, showing the start of its description,
  // See more and Edit.
  function ingredientRow(ingredient, picking) {
    const content = [
      bubble(ingredient),
      h("span", { class: "row-name" }, ingredient.name),
      ingredient.description ? h("span", { class: "row-desc" }, ingredient.description) : null,
    ];
    const focusKey = `ingredient:${ingredient.id}`;
    const main = picking
      ? h("button", { type: "button", class: "row-main", "aria-pressed": "false", "data-focus-key": focusKey },
          content,
          h("span", { class: "row-check", "aria-hidden": "true" }))
      : h("button", { type: "button", class: "row-main", "aria-expanded": "false", "data-focus-key": focusKey },
          content);

    // One ingredient form at a time, so no Edit while one's open.
    return h("li", { class: "row", draggable: "true", "data-kind": "ingredient", "data-id": ingredient.id },
      main,
      placeButton("ingredient", ingredient),
      picking ? null : rowTags("ingredients", ingredient),
      picking || ui.ingredientDraft ? null : rowTools("ingredient", ingredient));
  }

  function placeButton(kind, item) {
    return h("button", {
        type: "button",
        class: "row-place",
        title: "Put on the paper",
        "aria-label": `Put ${item.name} on the paper`,
        "data-focus-key": `place:${kind}:${item.id}`,
      },
      icon("plus"));
  }

  // Shown under a selected concrete or an opened ingredient: its tags, its page, and Edit.
  function rowTags(kind, item) {
    const tags = tagsOf(item);
    if (!tags.length) return null;
    return h("div", { class: "row-tags tag-row" },
      tags.map((tag) => tagButton(kind, tag, `tag:${kind}:${item.id}:${tag}`)));
  }

  function rowTools(kind, item) {
    return h("div", { class: "row-tools" },
      h("button", {
          type: "button",
          class: "row-action row-more",
          "aria-label": `See more about ${item.name}`,
          "data-focus-key": `more:${kind}:${item.id}`,
        },
        "See more"),
      editButton(kind, item));
  }

  function editButton(kind, item) {
    return h("button", {
        type: "button",
        class: "row-action row-edit",
        "aria-label": `Edit ${item.name}`,
        "data-focus-key": `edit:${kind}:${item.id}`,
      },
      "Edit");
  }

  // The forms are built once when opened and left alone after that, so
  // re-rendering never wipes out what someone is typing.
  function renderDrafts() {
    syncDraft(els.publishDraft, ui.publishDraft, publishDraftForm);
    syncDraft(els.concreteDraft, ui.concreteDraft, concreteDraftForm);
    syncDraft(els.ingredientDraft, ui.ingredientDraft, ingredientDraftForm);
    els.concreteList.inert = Boolean(ui.concreteDraft);
    panels.concretes.filter.inert = Boolean(ui.concreteDraft);
  }

  function syncDraft(host, draft, build) {
    if (!draft) host.replaceChildren();
    else if (!host.firstChild) host.append(build(draft));
  }

  function renderCanvas() {
    els.cards.replaceChildren(...doc.canvas.map(cardFor).filter(Boolean));
    els.emptyHint.hidden = doc.canvas.length > 0;
    fitSheet();
  }

  // Grow the sheet past the furthest card so there's always paper to drag onto.
  // Zoomed in, it's at least the view's size at 100%, so any spot can stay put
  // under the pointer while zooming.
  function fitSheet() {
    let right = 0;
    let bottom = 0;
    for (const node of els.cards.children) {
      right = Math.max(right, node.offsetLeft + node.offsetWidth);
      bottom = Math.max(bottom, node.offsetTop + node.offsetHeight);
    }
    const { clientWidth, clientHeight } = els.paper;
    const room = Math.max(ui.zoom, 1);
    els.sheet.style.width = `${Math.max((right + GRID * 8) * ui.zoom, clientWidth * room)}px`;
    els.sheet.style.height = `${Math.max((bottom + GRID * 8) * ui.zoom, clientHeight * room)}px`;
  }

  // Everything on the paper is its bubble, with its name underneath to say what it is.
  function cardFor(item) {
    const thing = item.kind === "concrete" ? findConcrete(item.ref) : findIngredient(item.ref);
    if (!thing) return null;

    const attrs = {
      class: `card card--${item.kind}`,
      tabindex: "0",
      role: "group",
      "aria-label": thing.name,
      "aria-describedby": "card-help",
      "data-id": item.id,
      "data-kind": item.kind,
      "data-ref": item.ref,
      "data-focus-key": `card:${item.id}`,
      style: `left: ${item.x}px; top: ${item.y}px`,
    };
    const remove = h("button", {
        type: "button",
        class: "card-remove",
        title: "Remove",
        "aria-label": `Remove ${thing.name} from the paper`,
      },
      icon("cross"));
    return h("div", attrs,
      bubble(thing),
      h("span", { class: "card-label" }, thing.name),
      remove);
  }

  function renderToolbar() {
    els.undo.setAttribute("aria-disabled", String(!history.past.length));
    els.redo.setAttribute("aria-disabled", String(!history.future.length));
    els.clear.setAttribute("aria-disabled", String(!doc.canvas.length));
    // Lit while their own form is open, not while an edit is.
    els.addConcrete.classList.toggle("is-on", Boolean(ui.concreteDraft && !ui.concreteDraft.editing));
    els.addIngredient.classList.toggle("is-on", Boolean(ui.ingredientDraft && !ui.ingredientDraft.editing));

    // Publish only shows while there's something to publish.
    const n = unpublishedCount(doc);
    const count = `${n} ${n === 1 ? "change" : "changes"}`;
    els.publish.hidden = !n && !ui.publishing && !ui.publishDraft;
    els.publish.setAttribute("aria-disabled", String(ui.publishing));
    els.publish.title = `${count} not published yet`;
    els.publishLabel.textContent = ui.publishing ? "Publishing…" : "Publish";
    els.publishCount.textContent = count;
    els.publishCount.hidden = ui.publishing || !n;
  }

  function paint() {
    const selected = ui.selectedId ? findConcrete(ui.selectedId) : null;
    const picking = ui.concreteDraft;
    const inMix = new Set(selected?.ingredients);

    for (const row of $$(".row", els.concreteList)) {
      const on = row.dataset.id === ui.selectedId;
      row.classList.toggle("is-selected", on);
      $(".row-main", row).setAttribute("aria-pressed", String(on));
    }

    for (const row of $$(".row", els.ingredientList)) {
      const id = row.dataset.id;
      const on = picking ? picking.picked.has(id) : inMix.has(id);
      const open = !picking && ui.openIngredients.has(id);
      const main = $(".row-main", row);
      row.classList.toggle("is-lit", on);
      row.classList.toggle("is-dim", Boolean(selected) && !picking && !on);
      row.classList.toggle("is-open", open);
      if (picking) main.setAttribute("aria-pressed", String(on));
      else if (main.hasAttribute("aria-expanded")) main.setAttribute("aria-expanded", String(open));
    }

    for (const card of els.cards.children) {
      const lit = card.dataset.kind === "concrete"
        ? card.dataset.ref === ui.selectedId
        : inMix.has(card.dataset.ref);
      card.classList.toggle("is-lit", lit);
    }

    const draft = ui.concreteDraft;
    setHint(els.concreteDraft, draft, () => {
      const n = pickedIds(draft).length;
      return n ? `${n} ${n === 1 ? "ingredient" : "ingredients"} picked.` : "Now click its ingredients on the right.";
    });
    setHint(els.ingredientDraft, ui.ingredientDraft, () => {
      if (!draft || ui.ingredientDraft.editing) return "";
      return draft.editing ? "It'll go into the concrete you're editing too." : "It'll go into the new concrete too.";
    });
    setHint(els.publishDraft, ui.publishDraft, () =>
      ui.publishing ? "Publishing…" : "The key is saved in this browser, so it's only needed once.");
  }

  // Only touch the hint when its text changes, so screen readers don't
  // re-announce it on every render.
  function setHint(host, draft, fallback) {
    const hint = draft && $(".draft-hint", host);
    if (!hint) return;
    const text = draft.error || fallback();
    if (hint.textContent !== text) hint.textContent = text;
    hint.classList.toggle("is-error", Boolean(draft.error));
    hint.hidden = !text;
  }

  // ---------------------------------------------------------------------------
  // Selecting

  function select(id) {
    if (ui.concreteDraft) return;
    ui.selectedId = id;
    // An open concrete page follows the selection, such as a card clicked on the paper.
    if (id && ui.page.concretes && ui.page.concretes !== id) {
      ui.page.concretes = id;
      renderPages();
    }
    paint();
    if (!id) return;
    revealRows([$(".row.is-selected", els.concreteList)]);
    revealRows($$(".row.is-lit", els.ingredientList));
  }

  function toggleOpen(id) {
    if (ui.openIngredients.has(id)) ui.openIngredients.delete(id);
    else ui.openIngredients.add(id);
    paint();
  }

  // Scroll a panel so these rows are in view. If the first row (with its group
  // heading) is hidden, bring it to the top. If it's showing but the rest can't
  // all fit, leave the panel alone rather than scrolling for a partial gain.
  function revealRows(rows) {
    // Rows in a list that a page is covering have nowhere to scroll to.
    rows = rows.filter((row) => row?.offsetParent);
    if (!rows.length) return;
    const box = rows[0].closest(".panel-scroll");
    const view = box.getBoundingClientRect();
    const pad = GRID / 2;
    const anchor = rows[0].closest(".group")?.querySelector(".group-name") ?? rows[0];
    const top = anchor.getBoundingClientRect().top - view.top - pad;
    const firstCutOff = rows[0].getBoundingClientRect().bottom > view.bottom;
    const bottom = rows.at(-1).getBoundingClientRect().bottom - view.bottom + pad;
    let delta = 0;
    if (top < 0 || firstCutOff) delta = top;
    else if (bottom > 0 && bottom <= top) delta = bottom;
    if (delta) box.scrollBy({ top: delta, behavior: scrollBehavior() });
  }

  // ---------------------------------------------------------------------------
  // Filtering
  //
  // Each list has a search box and a button for every tag used in it. Clicking
  // several tags narrows the list to the items that have all of them.

  function matchesFilter(kind, item) {
    const { text, tags } = ui.filters[kind];
    const own = new Set(tagsOf(item).map((tag) => tag.toLowerCase()));
    if ([...tags].some((tag) => !own.has(tag))) return false;
    const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const mix = kind === "concretes" ? ingredientsOf(item).map((i) => i.name) : [];
    const searched = [item.name, item.description, item.notes, item.group, ...tagsOf(item), ...mix].join(" ").toLowerCase();
    return words.every((word) => searched.includes(word));
  }

  // Every tag used in a list, alphabetically, in the spelling it first appears
  // in, keyed by lowercase.
  function knownTags(kind, exceptId = null) {
    const tags = new Map();
    for (const item of doc[kind]) {
      if (item.id === exceptId) continue;
      for (const tag of tagsOf(item)) {
        const key = tag.toLowerCase();
        if (!tags.has(key)) tags.set(key, tag);
      }
    }
    return new Map([...tags].sort((a, b) => a[1].localeCompare(b[1])));
  }

  // A tag that filters its list when clicked, and shows as pressed while it does.
  function tagButton(kind, tag, focusKey) {
    const key = tag.toLowerCase();
    return h("button", {
        type: "button",
        class: "tag",
        "aria-pressed": String(ui.filters[kind].tags.has(key)),
        "data-tag": key,
        "data-focus-key": focusKey,
      },
      tag);
  }

  function renderFilters() {
    for (const kind of KINDS) {
      const filter = ui.filters[kind];
      const known = knownTags(kind);
      // A tag goes away when the last item using it changes.
      for (const tag of filter.tags) {
        if (!known.has(tag)) filter.tags.delete(tag);
      }
      const bar = panels[kind].filter;
      $(".filter-tags", bar).replaceChildren(
        ...[...known.values()].map((tag) => tagButton(kind, tag, `filter:${kind}:${tag}`)));
      const filtering = filter.tags.size > 0 || filter.text.trim() !== "";
      const status = $(".filter-status", bar);
      status.hidden = !filtering;
      if (filtering) {
        const shown = doc[kind].filter((item) => matchesFilter(kind, item)).length;
        status.firstElementChild.textContent = shown ? `${shown} of ${doc[kind].length}` : "Nothing matches";
      }
    }
  }

  // Only the lists change, so the paper isn't redrawn on every key pressed.
  function refreshLists() {
    keepingFocus(() => {
      renderFilters();
      renderConcretes();
      renderIngredients();
      paint();
    });
  }

  function toggleFilterTag(kind, tag) {
    const { tags } = ui.filters[kind];
    if (tags.has(tag)) tags.delete(tag);
    else tags.add(tag);
    refreshLists();
  }

  function clearFilter(kind) {
    ui.filters[kind] = { text: "", tags: new Set() };
    $(".panel-search", panels[kind].filter).value = "";
  }

  // ---------------------------------------------------------------------------
  // Pages
  //
  // See more turns a panel into a page about one item: its picture, description,
  // what it's made of or used in, and notes. For now the notes are free text.

  function openPage(kind, id) {
    const box = panels[kind].page.closest(".panel-scroll");
    if (!ui.page[kind]) ui.pageScroll[kind] = box.scrollTop;
    ui.page[kind] = id;
    if (kind === "concretes") ui.selectedId = id;
    // Back from the page lands on the row, open, with its See more.
    else ui.openIngredients.add(id);
    render();
    box.scrollTop = 0;
    $(`[data-focus-key="back:${kind}"]`)?.focus({ preventScroll: true });
  }

  function closePage(kind) {
    const id = ui.page[kind];
    ui.page[kind] = null;
    render();
    panels[kind].page.closest(".panel-scroll").scrollTop = ui.pageScroll[kind];
    $(`[data-focus-key="more:${singular(kind)}:${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  }

  // A page takes its list's place, except while a form needs that list (ticking
  // a concrete's ingredients) or the page's own item is being edited.
  function renderPages() {
    for (const kind of KINDS) {
      const { page, list, filter } = panels[kind];
      const item = ui.page[kind] ? findItem(kind, ui.page[kind]) : null;
      if (!item) ui.page[kind] = null;
      const picking = kind === "ingredients" && Boolean(ui.concreteDraft);
      const editing = Boolean(kind === "concretes" ? ui.concreteDraft : ui.ingredientDraft);
      page.replaceChildren(...(item ? [pageFor(kind, item)] : []));
      page.hidden = !item || picking || editing;
      list.hidden = Boolean(item) && !picking;
      filter.hidden = list.hidden;
    }
  }

  function pageFor(kind, item) {
    const concrete = kind === "concretes";
    const related = concrete ? ingredientsOf(item) : doc.concretes.filter((c) => c.ingredients.includes(item.id));
    const notes = item.notes?.trim();
    const tags = tagsOf(item);
    return h("article", { class: "page", "aria-labelledby": `${kind}-page-title` },
      h("button", { type: "button", class: "page-back", "data-focus-key": `back:${kind}` },
        icon("back"),
        concrete ? "All concretes" : "All ingredients"),
      h("div", { class: "page-head" },
        bubble(item),
        h("h3", { class: "page-title", id: `${kind}-page-title` }, item.name)),
      item.description ? h("p", { class: "page-desc" }, item.description) : null,
      tags.length
        ? h("section", { class: "page-section" },
            h("h4", { class: "page-label" }, "Tags"),
            h("div", { class: "tag-row" }, tags.map((tag) => tagButton(kind, tag, `page-tag:${kind}:${tag}`))))
        : null,
      related.length
        ? h("section", { class: "page-section" },
            h("h4", { class: "page-label" }, concrete ? "Ingredients" : "Used in"),
            h("ul", { class: "page-links" },
              related.map((other) =>
                h("li", null,
                  h("button", {
                      type: "button",
                      class: "page-link",
                      "data-kind": concrete ? "ingredients" : "concretes",
                      "data-id": other.id,
                      "data-focus-key": `link:${kind}:${other.id}`,
                    },
                    bubble(other),
                    h("span", null, other.name))))))
        : null,
      h("section", { class: "page-section" },
        h("h4", { class: "page-label" }, "Notes"),
        notes
          ? h("div", { class: "page-notes" }, notes.split(/\n\s*\n/).map((paragraph) => h("p", null, paragraph)))
          : h("p", { class: "page-empty" }, "No notes yet.")),
      h("div", { class: "page-actions" }, editButton(singular(kind), item)));
  }

  // ---------------------------------------------------------------------------
  // Add and edit forms
  //
  // Adding and editing share a form, filled in from the item when editing.
  // The edit forms also have Delete, which Undo can take back.

  function openConcreteDraft(id = null) {
    if (!ui.concreteDraft) {
      const concrete = id ? findConcrete(id) : null;
      ui.concreteDraft = {
        editing: concrete?.id ?? null,
        name: concrete?.name ?? "",
        description: concrete?.description ?? "",
        notes: concrete?.notes ?? "",
        tags: tagsOf(concrete).join(", "),
        icon: concrete?.icon ?? "",
        picked: new Set(concrete?.ingredients),
        error: "",
      };
      ui.selectedId = null;
      render();
    }
    $("#concrete-name").focus();
  }

  // Leaving an edit goes back to that concrete, selected, with Edit focused.
  function closeConcreteDraft() {
    const id = ui.concreteDraft.editing;
    ui.concreteDraft = null;
    if (id) ui.selectedId = id;
    render();
    (id ? $(`[data-focus-key="edit:concrete:${CSS.escape(id)}"]`) : els.addConcrete)?.focus();
  }

  function togglePick(id) {
    const draft = ui.concreteDraft;
    if (draft.picked.has(id)) draft.picked.delete(id);
    else draft.picked.add(id);
    draft.error = "";
    paint();
  }

  async function saveConcreteDraft() {
    const draft = ui.concreteDraft;
    if (!(await iconReady(draft)) || ui.concreteDraft !== draft) return;
    const name = draft.name.trim();
    const ingredients = pickedIds(draft);
    const nameError = !name
      ? "Give it a name first."
      : doc.concretes.some((c) => c.id !== draft.editing && sameName(c.name, name))
        ? `There's already a concrete called ${name}.`
        : "";
    draft.error = nameError || (ingredients.length ? "" : "Pick at least one ingredient on the right.");
    if (draft.error) {
      paint();
      if (nameError) $("#concrete-name").focus();
      return;
    }

    const id = draft.editing ?? uniqueId(name, doc.concretes);
    const item = withFields(draft.editing ? findConcrete(id) : { id }, {
      name,
      description: draft.description.trim(),
      notes: draft.notes.trim(),
      tags: parseTags(draft.tags, "concretes", draft.editing),
      icon: draft.icon,
      ingredients,
    });
    ui.concreteDraft = null;
    ui.selectedId = id;
    // A concrete page that was open shows the one just saved.
    if (ui.page.concretes) ui.page.concretes = id;
    if (!matchesFilter("concretes", item)) clearFilter("concretes");
    if (draft.editing) {
      commit((d) => {
        d.concretes = d.concretes.map((c) => (c.id === id ? item : c));
      });
    } else {
      commit((d) => d.concretes.push(item));
    }

    const row = $(`.row[data-id="${CSS.escape(id)}"]`, els.concreteList);
    const next = draft.editing || ui.page.concretes ? $(`[data-focus-key="edit:concrete:${CSS.escape(id)}"]`) : $(".row-main", row);
    next?.focus({ preventScroll: true });
    revealRows([row]);
    revealRows($$(".row.is-lit", els.ingredientList));
  }

  // An item with a form's fields, leaving out empty notes or tags it never had,
  // so that saving without a change doesn't count as one.
  function withFields(item, fields) {
    const next = { ...item, ...fields };
    for (const key of ["notes", "tags"]) {
      if (!fields[key].length && !Object.hasOwn(item, key)) delete next[key];
    }
    return next;
  }

  // Tags as typed, with commas between them, in the spelling already in use for
  // any that are on another item, so one tag doesn't become two.
  function parseTags(text, kind, exceptId) {
    const known = knownTags(kind, exceptId);
    const tags = new Map();
    for (const part of text.split(",")) {
      const tag = part.trim();
      const key = tag.toLowerCase();
      if (tag && !tags.has(key)) tags.set(key, known.get(key) ?? tag);
    }
    return [...tags.values()];
  }

  function deleteConcrete(id) {
    const concrete = findConcrete(id);
    ui.concreteDraft = null;
    commit((d) => {
      d.concretes = d.concretes.filter((c) => c.id !== id);
      d.canvas = d.canvas.filter((card) => !(card.kind === "concrete" && card.ref === id));
    });
    els.addConcrete.focus();
    showToast(`Deleted ${concrete.name}.`, { label: "Undo", run: undo });
  }

  function openIngredientDraft(id = null) {
    if (!ui.ingredientDraft) {
      const ingredient = id ? findIngredient(id) : null;
      ui.ingredientDraft = {
        editing: ingredient?.id ?? null,
        name: ingredient?.name ?? "",
        description: ingredient?.description ?? "",
        notes: ingredient?.notes ?? "",
        tags: tagsOf(ingredient).join(", "),
        icon: ingredient?.icon ?? "",
        group: ingredient?.group ?? "",
        error: "",
      };
      render();
    }
    $("#ingredient-name").focus();
  }

  // Leaving an edit goes back to that ingredient's Edit button.
  function closeIngredientDraft() {
    const id = ui.ingredientDraft.editing;
    ui.ingredientDraft = null;
    render();
    (id ? $(`[data-focus-key="edit:ingredient:${CSS.escape(id)}"]`) : els.addIngredient)?.focus();
  }

  async function saveIngredientDraft() {
    const draft = ui.ingredientDraft;
    if (!(await iconReady(draft)) || ui.ingredientDraft !== draft) return;
    const name = draft.name.trim();
    draft.error = !name
      ? "Give it a name first."
      : doc.ingredients.some((i) => i.id !== draft.editing && sameName(i.name, name))
        ? `${name} is already in the list.`
        : "";
    if (draft.error) {
      paint();
      $("#ingredient-name").focus();
      return;
    }

    const id = draft.editing ?? uniqueId(name, doc.ingredients);
    const item = withFields(draft.editing ? findIngredient(id) : { id }, {
      name,
      description: draft.description.trim(),
      notes: draft.notes.trim(),
      tags: parseTags(draft.tags, "ingredients", draft.editing),
      icon: draft.icon,
      group: draft.group.trim(),
    });
    ui.ingredientDraft = null;
    // An ingredient page that was open shows the one just saved, unless the list
    // is busy being ticked for a concrete.
    if (ui.page.ingredients && !ui.concreteDraft) ui.page.ingredients = id;
    if (!matchesFilter("ingredients", item)) clearFilter("ingredients");
    if (draft.editing) {
      ui.openIngredients.add(id);
      commit((d) => {
        d.ingredients = d.ingredients.map((i) => (i.id === id ? item : i));
      });
    } else {
      ui.concreteDraft?.picked.add(id);
      commit((d) => d.ingredients.push(item));
    }

    const row = $(`.row[data-id="${CSS.escape(id)}"]`, els.ingredientList);
    revealRows([row]);
    flash(row);
    const editKey = `[data-focus-key="edit:ingredient:${CSS.escape(id)}"]`;
    const next = ui.concreteDraft
      ? $(".row-main", row)
      : draft.editing || ui.page.ingredients ? $(editKey) : els.addIngredient;
    next?.focus({ preventScroll: true });
  }

  // Concretes that used it lose it too, and Undo puts it all back.
  function deleteIngredient(id) {
    const ingredient = findIngredient(id);
    const users = doc.concretes.filter((c) => c.ingredients.includes(id)).length;
    ui.ingredientDraft = null;
    ui.openIngredients.delete(id);
    commit((d) => {
      d.ingredients = d.ingredients.filter((i) => i.id !== id);
      d.concretes = d.concretes.map((c) =>
        c.ingredients.includes(id) ? { ...c, ingredients: c.ingredients.filter((x) => x !== id) } : c);
      d.canvas = d.canvas.filter((card) => !(card.kind === "ingredient" && card.ref === id));
    });
    els.addIngredient.focus();
    const note = users ? ` It's also been taken out of ${users} ${users === 1 ? "concrete" : "concretes"}.` : "";
    showToast(`Deleted ${ingredient.name}.${note}`, { label: "Undo", run: undo });
  }

  function concreteDraftForm(draft) {
    return draftForm({
      title: draft.editing ? "Edit concrete" : "New concrete",
      fields: [
        field("Name", textField("concrete-name", draft, "name")),
        field("Description", textField("concrete-description", draft, "description", true)),
        field("Notes", notesField("concrete-notes", draft)),
        tagsField("concrete-tags", draft, "concretes"),
        iconField("concrete-icon", draft),
      ],
      onSave: saveConcreteDraft,
      onCancel: closeConcreteDraft,
      extra: draft.editing ? altButton("Delete this concrete", () => deleteConcrete(draft.editing)) : null,
    });
  }

  function ingredientDraftForm(draft) {
    const groupNames = ingredientGroups().map((g) => g.name).filter(Boolean);
    const group = textField("ingredient-group", draft, "group");
    group.setAttribute("list", "ingredient-group-options");

    return draftForm({
      title: draft.editing ? "Edit ingredient" : "New ingredient",
      fields: [
        field("Name", textField("ingredient-name", draft, "name")),
        field("Description", textField("ingredient-description", draft, "description", true)),
        field("Notes", notesField("ingredient-notes", draft)),
        tagsField("ingredient-tags", draft, "ingredients"),
        iconField("ingredient-icon", draft),
        field("Group (optional)", group,
          h("datalist", { id: "ingredient-group-options" }, groupNames.map((name) => h("option", { value: name })))),
      ],
      onSave: saveIngredientDraft,
      onCancel: closeIngredientDraft,
      extra: draft.editing ? altButton("Delete this ingredient", () => deleteIngredient(draft.editing)) : null,
    });
  }

  // Notes are the longer write-up on an item's page, so they get more room.
  function notesField(id, draft) {
    const control = textField(id, draft, "notes", true);
    control.rows = 8;
    control.maxLength = 20000;
    control.placeholder = "Shown on its page, under See more";
    return control;
  }

  // Tags are typed with commas between them. The ones already in use on other
  // items are there to click, which keeps their spelling the same.
  function tagsField(id, draft, kind) {
    const input = textField(id, draft, "tags");
    input.maxLength = 500;
    input.placeholder = "Separate with commas";
    const typed = () => draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean);
    const offers = [...knownTags(kind, draft.editing).values()].map((tag) =>
      h("button", {
          type: "button",
          class: "tag",
          onclick: () => {
            const current = typed();
            const others = current.filter((other) => !sameName(other, tag));
            draft.tags = (others.length < current.length ? others : [...current, tag]).join(", ");
            input.value = draft.tags;
            showPressed();
          },
        },
        tag));
    const showPressed = () => {
      const current = typed();
      for (const offer of offers) {
        offer.setAttribute("aria-pressed", String(current.some((tag) => sameName(tag, offer.textContent))));
      }
    };
    input.addEventListener("input", showPressed);
    showPressed();
    return field("Tags (optional)", input, offers.length ? h("div", { class: "tag-row" }, offers) : null);
  }

  function textField(id, draft, key, multiline = false) {
    const control = h(multiline ? "textarea" : "input", {
      class: "draft-input",
      id,
      type: multiline ? null : "text",
      rows: multiline ? "3" : null,
      maxlength: multiline ? "2000" : "80",
      autocomplete: "off",
      oninput: (event) => {
        draft[key] = event.target.value;
        if (draft.error) {
          draft.error = "";
          paint();
        }
      },
    });
    control.value = draft[key];
    return control;
  }

  // The icon is optional. A chosen image is shrunk and stored with the item,
  // and the bubble beside the buttons shows what it will look like.
  function iconField(id, draft) {
    const preview = h("span", { class: "bubble", "aria-hidden": "true" });
    const file = h("input", { type: "file", accept: "image/*", hidden: true });
    const choose = h("button", { type: "button", class: "btn btn--quiet", id }, "Choose image");
    const remove = h("button", { type: "button", class: "btn btn--plain" }, "Remove");

    const show = () => {
      preview.replaceChildren(...(draft.icon ? [h("img", { src: draft.icon, alt: "" })] : []));
      choose.textContent = draft.icon ? "Change image" : "Choose image";
      remove.hidden = !draft.icon;
    };

    choose.addEventListener("click", () => file.click());
    remove.addEventListener("click", () => {
      draft.icon = "";
      show();
      choose.focus();
    });
    file.addEventListener("change", async () => {
      const chosen = file.files[0];
      file.value = "";
      if (!chosen) return;
      // Saving waits on this, so a quick click on Save doesn't lose the icon.
      const job = iconFromFile(chosen);
      draft.iconJob = job;
      try {
        const icon = await job;
        if (draft.iconJob === job) draft.icon = icon;
        draft.error = "";
      } catch {
        draft.error = "That file couldn't be opened as an image.";
      } finally {
        if (draft.iconJob === job) draft.iconJob = null;
      }
      show();
      paint();
    });
    show();

    return h("div", { class: "draft-field", role: "group", "aria-labelledby": `${id}-label` },
      h("span", { class: "draft-label", id: `${id}-label` }, "Icon"),
      h("div", { class: "icon-field" }, preview, choose, remove, file));
  }

  // Wait for an icon that's still being processed. False if it failed, in
  // which case the form is already showing why.
  async function iconReady(draft) {
    if (!draft.iconJob) return true;
    try {
      await draft.iconJob;
    } catch {
      return false;
    }
    return !draft.error;
  }

  // Crop an image to a small square so icons stay light enough to keep in
  // browser storage and in data.js.
  async function iconFromFile(file) {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const width = image.naturalWidth || ICON_SIZE;
      const height = image.naturalHeight || ICON_SIZE;
      const scale = Math.max(ICON_SIZE / width, ICON_SIZE / height);
      const canvas = document.createElement("canvas");
      canvas.width = ICON_SIZE;
      canvas.height = ICON_SIZE;
      const context = canvas.getContext("2d");
      context.imageSmoothingQuality = "high";
      context.drawImage(image,
        (ICON_SIZE - width * scale) / 2, (ICON_SIZE - height * scale) / 2,
        width * scale, height * scale);
      // WebP keeps transparency and stays small. Browsers that can't write it
      // hand back PNG instead.
      const webp = canvas.toDataURL("image/webp", 0.85);
      return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/png");
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function field(label, control, ...extras) {
    return h("div", { class: "draft-field" },
      h("label", { class: "draft-label", for: control.id }, label),
      control,
      extras);
  }

  function draftForm({ title, fields, onSave, onCancel, saveLabel = "Save", extra = null }) {
    return h("form", {
        class: "draft",
        "aria-label": title,
        onsubmit: (event) => {
          event.preventDefault();
          onSave();
        },
        onkeydown: (event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          onCancel();
        },
      },
      h("p", { class: "draft-title" }, title),
      fields,
      h("p", { class: "draft-hint", role: "status" }),
      h("div", { class: "draft-actions" },
        h("button", { type: "submit", class: "btn btn--marker" }, saveLabel),
        h("button", { type: "button", class: "btn btn--quiet", onclick: onCancel }, "Cancel")),
      extra);
  }

  // A second way out of a form, like Delete or Download, set below its buttons.
  function altButton(label, onclick) {
    return h("button", { type: "button", class: "btn btn--plain draft-alt", onclick }, label);
  }

  // ---------------------------------------------------------------------------
  // Canvas

  function place(kind, ref, at) {
    const id = `card-${++cardCount}`;
    const { x, y } = at ?? freeSpot(kind);
    commit((d) => d.canvas.push({ id, kind, ref, x, y }));
    const card = cardNode(id);
    if (!at) card.scrollIntoView({ block: "nearest", inline: "nearest", behavior: scrollBehavior() });
    flash(card);
  }

  // The first spot in the visible part of the paper, reading left to right and
  // top to bottom, where a card fits without touching another or the toolbar.
  function freeSpot(kind) {
    // A concrete's bubble is a size up from an ingredient's (see .card--concrete).
    const [width, height] = kind === "concrete" ? [GRID * 6, GRID * 7] : [GRID * 5, GRID * 6];
    const { scrollLeft, scrollTop, clientWidth } = els.paper;
    const frame = els.paper.getBoundingClientRect();
    // Where a control sits over the paper, in the paper's own units.
    const onPaper = (node) => {
      const box = node.getBoundingClientRect();
      return {
        x: (scrollLeft + box.left - frame.left) / ui.zoom,
        y: (scrollTop + box.top - frame.top) / ui.zoom,
        w: box.width / ui.zoom,
        h: box.height / ui.zoom,
      };
    };
    const taken = [
      ...doc.canvas.map((item) => {
        const node = cardNode(item.id);
        return { x: item.x, y: item.y, w: node?.offsetWidth ?? 0, h: node?.offsetHeight ?? 0 };
      }),
      ...[els.toolbar, els.publish, els.zoom].filter((node) => !node.hidden).map(onPaper),
    ];
    const fits = (x, y) =>
      taken.every((r) =>
        x >= r.x + r.w + GRID || x + width + GRID <= r.x || y >= r.y + r.h + GRID || y + height + GRID <= r.y);

    const left = snap(scrollLeft / ui.zoom) + GRID * 2;
    const top = snap(scrollTop / ui.zoom) + GRID * 2;
    const right = Math.max(left, (scrollLeft + clientWidth) / ui.zoom - width - GRID * 2);
    for (let y = top; y < top + GRID * 400; y += GRID) {
      for (let x = left; x <= right; x += GRID) {
        if (fits(x, y)) return { x, y };
      }
    }
    return { x: left, y: top };
  }

  function removeCard(id, keepFocusOnCards) {
    const nodes = [...els.cards.children];
    const index = nodes.findIndex((node) => node.dataset.id === id);
    const neighbour = (nodes[index + 1] ?? nodes[index - 1])?.dataset.id;
    commit((d) => {
      d.canvas = d.canvas.filter((c) => c.id !== id);
    });
    const next = keepFocusOnCards && neighbour ? cardNode(neighbour) : null;
    (next ?? els.paper).focus({ preventScroll: true });
  }

  function onCardPointerDown(event) {
    const card = event.target.closest(".card");
    if (pinch || !card || event.button !== 0 || event.target.closest(".card-remove")) return;
    event.preventDefault();
    card.focus({ preventScroll: true });

    const item = findCard(card.dataset.id);
    const start = { x: event.clientX, y: event.clientY };
    let to = { x: item.x, y: item.y };
    let moved = false;
    const done = new AbortController();
    card.setPointerCapture(event.pointerId);

    card.addEventListener("pointermove", (move) => {
      const dx = move.clientX - start.x;
      const dy = move.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      card.classList.add("is-dragging");
      to = { x: snap(item.x + dx / ui.zoom), y: snap(item.y + dy / ui.zoom) };
      card.style.left = `${to.x}px`;
      card.style.top = `${to.y}px`;
    }, { signal: done.signal });

    const stop = () => {
      done.abort();
      cancelCardDrag = null;
      card.classList.remove("is-dragging");
    };
    // A second finger coming down turns the gesture into a pinch instead.
    cancelCardDrag = () => {
      stop();
      card.style.left = `${item.x}px`;
      card.style.top = `${item.y}px`;
    };
    const finish = () => {
      stop();
      if (moved && (to.x !== item.x || to.y !== item.y)) {
        // A moved card goes to the end of the list so it draws on top.
        commit((d) => {
          d.canvas = d.canvas.filter((c) => c.id !== item.id);
          d.canvas.push({ ...item, ...to });
        });
      } else if (!moved) {
        // A click selects a concrete. On an ingredient it just moves on from
        // whatever was selected, leaving that bubble with the focus ring.
        select(item.kind === "concrete" ? item.ref : null);
      }
    };
    card.addEventListener("pointerup", finish, { signal: done.signal });
    card.addEventListener("pointercancel", finish, { signal: done.signal });
  }

  function onCardKeydown(event) {
    const card = event.target;
    if (!card.classList?.contains("card")) return;
    const item = findCard(card.dataset.id);

    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      removeCard(item.id, true);
    } else if ((event.key === "Enter" || event.key === " ") && item.kind === "concrete") {
      event.preventDefault();
      select(item.ref);
    } else if (Object.hasOwn(NUDGES, event.key)) {
      event.preventDefault();
      const step = event.shiftKey ? GRID * 5 : GRID;
      const x = Math.max(0, item.x + NUDGES[event.key][0] * step);
      const y = Math.max(0, item.y + NUDGES[event.key][1] * step);
      if (x === item.x && y === item.y) return;
      commit((d) => Object.assign(d.canvas.find((c) => c.id === item.id), { x, y }), `nudge:${item.id}`);
      cardNode(item.id)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  // ---------------------------------------------------------------------------
  // Zooming and moving around the paper
  //
  // Zooming scales the layer the cards sit on, so a card's x and y stay in the
  // paper's own units whatever the zoom. Distances on screen get divided by
  // ui.zoom on the way in.

  // Keeps the spot at `at` (the middle of the view without one) where it is on screen.
  function setZoom(next, at) {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    const zoom = Math.abs(clamped - 1) < 0.02 ? 1 : clamped; // settle on exactly 100%
    const { paper } = els;
    const box = paper.getBoundingClientRect();
    const x = at ? at.x - box.left : paper.clientWidth / 2;
    const y = at ? at.y - box.top : paper.clientHeight / 2;
    const paperX = (paper.scrollLeft + x) / ui.zoom;
    const paperY = (paper.scrollTop + y) / ui.zoom;
    ui.zoom = zoom;
    applyZoom();
    paper.scrollLeft = paperX * zoom - x;
    paper.scrollTop = paperY * zoom - y;
  }

  function applyZoom() {
    const percent = `${Math.round(ui.zoom * 100)}%`;
    els.cards.style.transform = `scale(${ui.zoom})`;
    // The dots stay on the grid, but drop to every 2nd or 4th so that zooming
    // out doesn't turn the paper grey.
    const every = ui.zoom < 0.5 ? 4 : ui.zoom < 0.75 ? 2 : 1;
    els.sheet.style.setProperty("--dot-step", `${GRID * ui.zoom * every}px`);
    els.zoomLevel.textContent = percent;
    els.zoomLevel.setAttribute("aria-label", `Zoomed to ${percent}. Back to 100%`);
    els.zoomOut.setAttribute("aria-disabled", String(ui.zoom <= MIN_ZOOM));
    els.zoomIn.setAttribute("aria-disabled", String(ui.zoom >= MAX_ZOOM));
    fitSheet();
  }

  function stepZoom(direction) {
    const next = direction > 0
      ? ZOOM_STEPS.find((step) => step > ui.zoom + 0.001)
      : ZOOM_STEPS.findLast((step) => step < ui.zoom - 0.001);
    if (next) setZoom(next);
  }

  // A press on empty paper drags it around, or clears the selection if it was
  // just a click. Two fingers anywhere on the paper pinch to zoom.
  const pressed = new Map(); // pointers down on the paper, by id, with where they are now
  let pan = null; // { x, y, left, top, moved } while the empty paper is held
  let pinch = null; // { distance, zoom, x, y } while two fingers are down
  let cancelCardDrag = null;

  function onPaperPointerDown(event) {
    // A press on the paper's own scrollbar lands on the paper rather than the sheet.
    if (event.target === els.paper || event.button !== 0) return;
    if (event.isPrimary) {
      pressed.clear();
      pan = null;
      pinch = null;
    }
    pressed.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pressed.size === 2) {
      cancelCardDrag?.();
      pan = null;
      const [a, b] = pressed.values();
      pinch = {
        distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        zoom: ui.zoom,
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
      };
    } else if (pressed.size === 1 && !event.target.closest(".card")) {
      pan = {
        x: event.clientX,
        y: event.clientY,
        left: els.paper.scrollLeft,
        top: els.paper.scrollTop,
        moved: false,
      };
      els.paper.setPointerCapture(event.pointerId);
    }
  }

  function onPaperPointerMove(event) {
    const point = pressed.get(event.pointerId);
    if (!point) return;
    point.x = event.clientX;
    point.y = event.clientY;
    if (pinch) {
      const [a, b] = pressed.values();
      const x = (a.x + b.x) / 2;
      const y = (a.y + b.y) / 2;
      setZoom(pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance, { x, y });
      els.paper.scrollLeft -= x - pinch.x;
      els.paper.scrollTop -= y - pinch.y;
      pinch.x = x;
      pinch.y = y;
    } else if (pan) {
      const dx = event.clientX - pan.x;
      const dy = event.clientY - pan.y;
      if (!pan.moved && Math.hypot(dx, dy) < 4) return;
      pan.moved = true;
      els.workspace.classList.add("is-panning");
      els.paper.scrollLeft = pan.left - dx;
      els.paper.scrollTop = pan.top - dy;
    }
  }

  function onPaperPointerEnd(event) {
    if (!pressed.delete(event.pointerId)) return;
    if (pan && !pan.moved && event.type === "pointerup") {
      select(null);
      els.paper.focus({ preventScroll: true });
    }
    pan = null;
    if (pressed.size < 2) pinch = null;
    els.workspace.classList.remove("is-panning");
  }

  // ---------------------------------------------------------------------------
  // Events

  els.concreteList.addEventListener("click", (event) => {
    const row = event.target.closest(".row");
    const tag = event.target.closest(".tag");
    if (!row) return;
    if (tag) toggleFilterTag("concretes", tag.dataset.tag);
    else if (event.target.closest(".row-place")) place("concrete", row.dataset.id);
    else if (event.target.closest(".row-more")) openPage("concretes", row.dataset.id);
    else if (event.target.closest(".row-edit")) openConcreteDraft(row.dataset.id);
    else if (event.target.closest(".row-tools, .row-tags")) return;
    else select(ui.selectedId === row.dataset.id ? null : row.dataset.id);
  });

  els.ingredientList.addEventListener("click", (event) => {
    const row = event.target.closest(".row");
    const tag = event.target.closest(".tag");
    if (!row) return;
    if (tag) toggleFilterTag("ingredients", tag.dataset.tag);
    else if (event.target.closest(".row-place")) place("ingredient", row.dataset.id);
    else if (event.target.closest(".row-more")) openPage("ingredients", row.dataset.id);
    else if (event.target.closest(".row-edit")) openIngredientDraft(row.dataset.id);
    else if (!event.target.closest("button.row-main")) return;
    else if (ui.concreteDraft) togglePick(row.dataset.id);
    else toggleOpen(row.dataset.id);
  });

  for (const kind of KINDS) {
    const { page, filter } = panels[kind];
    const search = $(".panel-search", filter);

    page.addEventListener("click", (event) => {
      const link = event.target.closest(".page-link");
      const tag = event.target.closest(".tag");
      if (event.target.closest(".page-back")) closePage(kind);
      else if (tag) {
        // Back to the list, showing everything with this tag.
        clearFilter(kind);
        ui.filters[kind].tags.add(tag.dataset.tag);
        closePage(kind);
      } else if (event.target.closest(".row-edit")) {
        (kind === "concretes" ? openConcreteDraft : openIngredientDraft)(ui.page[kind]);
      } else if (link) openPage(link.dataset.kind, link.dataset.id);
    });

    search.addEventListener("input", () => {
      ui.filters[kind].text = search.value;
      refreshLists();
    });
    search.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !search.value) return;
      event.preventDefault();
      search.value = "";
      ui.filters[kind].text = "";
      refreshLists();
    });
    filter.addEventListener("click", (event) => {
      const tag = event.target.closest(".tag");
      if (tag) toggleFilterTag(kind, tag.dataset.tag);
      else if (event.target.closest(".filter-clear")) {
        clearFilter(kind);
        refreshLists();
        search.focus();
      }
    });
  }

  for (const list of [els.concreteList, els.ingredientList]) {
    list.addEventListener("dragstart", (event) => {
      const row = event.target.closest?.(".row");
      if (!row) return;
      event.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ kind: row.dataset.kind, ref: row.dataset.id }));
      event.dataTransfer.setData("text/plain", $(".row-name", row).textContent);
      event.dataTransfer.effectAllowed = "copy";
    });
  }

  els.paper.addEventListener("dragover", (event) => {
    if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    els.workspace.classList.add("is-drop-target");
  });

  els.paper.addEventListener("dragleave", (event) => {
    if (!els.paper.contains(event.relatedTarget)) els.workspace.classList.remove("is-drop-target");
  });

  els.paper.addEventListener("drop", (event) => {
    els.workspace.classList.remove("is-drop-target");
    const data = event.dataTransfer.getData(DRAG_TYPE);
    if (!data) return;
    event.preventDefault();
    const { kind, ref } = JSON.parse(data);
    const origin = els.sheet.getBoundingClientRect();
    // Land the bubble centred on the pointer.
    const [dx, dy] = kind === "concrete" ? [GRID * 3, GRID * 2.5] : [GRID * 2.5, GRID * 2];
    place(kind, ref, {
      x: snap((event.clientX - origin.left) / ui.zoom - dx),
      y: snap((event.clientY - origin.top) / ui.zoom - dy),
    });
  });

  document.addEventListener("dragend", () => els.workspace.classList.remove("is-drop-target"));

  // First, so that a second finger on a card starts a pinch rather than a drag.
  els.paper.addEventListener("pointerdown", onPaperPointerDown, { capture: true });
  addEventListener("pointermove", onPaperPointerMove);
  addEventListener("pointerup", onPaperPointerEnd);
  addEventListener("pointercancel", onPaperPointerEnd);

  // A trackpad pinch arrives as a wheel event with ctrlKey set, in all but Safari.
  els.workspace.addEventListener("wheel", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1);
    const step = Math.max(-25, Math.min(25, delta));
    setZoom(ui.zoom * Math.exp(-step * 0.01), { x: event.clientX, y: event.clientY });
  }, { passive: false });

  // Safari's own events for that. On a touch screen the pointers above have it covered.
  let gestureStartZoom = 1;
  els.workspace.addEventListener("gesturestart", (event) => {
    event.preventDefault();
    gestureStartZoom = ui.zoom;
  });
  els.workspace.addEventListener("gesturechange", (event) => {
    event.preventDefault();
    if (!pressed.size) setZoom(gestureStartZoom * event.scale, { x: event.clientX, y: event.clientY });
  });

  els.zoomOut.addEventListener("click", () => {
    if (isEnabled(els.zoomOut)) stepZoom(-1);
  });
  els.zoomIn.addEventListener("click", () => {
    if (isEnabled(els.zoomIn)) stepZoom(1);
  });
  els.zoomLevel.addEventListener("click", () => setZoom(1));

  els.sheet.addEventListener("pointerdown", onCardPointerDown);
  els.sheet.addEventListener("keydown", onCardKeydown);
  els.sheet.addEventListener("click", (event) => {
    const button = event.target.closest(".card-remove");
    // `detail` is 0 when the button was pressed from the keyboard.
    if (button) removeCard(button.closest(".card").dataset.id, event.detail === 0);
  });

  els.addConcrete.addEventListener("click", () => openConcreteDraft());
  els.addIngredient.addEventListener("click", () => openIngredientDraft());
  els.clear.addEventListener("click", () => {
    if (isEnabled(els.clear)) commit((d) => { d.canvas = []; });
  });
  els.undo.addEventListener("click", () => {
    if (isEnabled(els.undo)) undo();
  });
  els.redo.addEventListener("click", () => {
    if (isEnabled(els.redo)) redo();
  });
  els.publish.addEventListener("click", () => {
    if (ui.publishDraft) savePublishDraft();
    else publish();
  });

  document.addEventListener("keydown", (event) => {
    const key = (event.key ?? "").toLowerCase();
    const inField = event.target instanceof Element && event.target.matches("input, textarea, select");
    const mod = isMac ? event.metaKey : event.ctrlKey;

    if (mod && !event.altKey && !inField && (key === "z" || (key === "y" && !isMac))) {
      event.preventDefault();
      if (key === "y" || event.shiftKey) redo();
      else undo();
    } else if (key === "escape" && !event.defaultPrevented) {
      if (ui.concreteDraft) closeConcreteDraft();
      else if (ui.ingredientDraft) closeIngredientDraft();
      else if (ui.publishDraft) closePublishDraft();
      else if (ui.page.ingredients) closePage("ingredients");
      else if (ui.page.concretes) closePage("concretes");
      else if (ui.selectedId) select(null);
    }
  });

  // ---------------------------------------------------------------------------
  // Helpers

  function h(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs ?? {})) {
      if (value === null || value === undefined || value === false) continue;
      if (name.startsWith("on")) node.addEventListener(name.slice(2), value);
      else if (name === "class") node.className = value;
      else node.setAttribute(name, value === true ? "" : value);
    }
    node.append(...children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false));
    return node;
  }

  // The circle every concrete and ingredient gets. An icon that fails to load
  // falls back to the empty circle.
  function bubble(item) {
    return h("span", { class: "bubble", "aria-hidden": "true" },
      item.icon
        ? h("img", { src: item.icon, alt: "", draggable: "false", onerror: (event) => event.target.remove() })
        : null);
  }

  function icon(name) {
    const svg = document.createElementNS(SVG_NS, "svg");
    const path = document.createElementNS(SVG_NS, "path");
    for (const [key, value] of Object.entries({
      width: 16, height: 16, viewBox: "0 0 16 16", fill: "none",
      stroke: "currentColor", "stroke-width": 1.75, "stroke-linecap": "square", "aria-hidden": "true",
    })) svg.setAttribute(key, value);
    path.setAttribute("d", ICONS[name]);
    svg.append(path);
    return svg;
  }

  function uniqueId(name, existing) {
    const base = name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "item";
    let id = base;
    for (let n = 2; existing.some((x) => x.id === id); n++) id = `${base}-${n}`;
    return id;
  }

  function flash(node) {
    if (!node) return;
    node.classList.add("is-new");
    node.addEventListener("animationend", () => node.classList.remove("is-new"), { once: true });
  }

  // Catch typos in data.js early instead of silently dropping ingredients.
  function checkSeed() {
    const ingredientIds = new Set(seed.ingredients.map((i) => i.id));
    for (const c of seed.concretes) {
      for (const id of c.ingredients ?? []) {
        if (!ingredientIds.has(id)) console.warn(`data.js: ${c.name} lists "${id}", which isn't in ingredients.`);
      }
    }
  }

  // ---------------------------------------------------------------------------

  els.undo.title = isMac ? "Undo (⌘Z)" : "Undo (Ctrl+Z)";
  els.redo.title = isMac ? "Redo (⇧⌘Z)" : "Redo (Ctrl+Y)";
  const zoomHint = isMac ? "pinch, or hold ⌘ and scroll" : "pinch, or hold Ctrl and scroll";
  els.zoomOut.title = `Zoom out (or ${zoomHint})`;
  els.zoomIn.title = `Zoom in (or ${zoomHint})`;
  checkSeed();
  applyZoom();
  render();
})();
