const pageLabels = {
  dashboard: "工作台",
  "new-project": "新建作品",
  bible: "故事圣经",
  settings: "设定中心",
  outline: "大纲工作台",
  writing: "写作台",
  batch: "批量生产",
  changes: "修改与版本",
};

const validPages = new Set(Object.keys(pageLabels));
const pageTitles = {
  dashboard: "工作台 · 墨舟",
  "new-project": "新建作品 · 墨舟",
  bible: "故事圣经 · 墨舟",
  settings: "设定中心 · 墨舟",
  outline: "大纲工作台 · 墨舟",
  writing: "写作台 · 墨舟",
  batch: "批量生产 · 墨舟",
  changes: "修改与版本 · 墨舟",
};

const chapters = {
  45: {
    title: "血河渡口",
    paragraphs: [
      "血河渡口的灯一直亮着，像一只不肯闭上的眼睛。",
      "沈砚把斗笠压得更低，混在赶夜路的商队里。他听见有人在讨论血河宗，说最近南境不太平，连着三座小镇都被抽干了水。",
      "顾青走在他半步之后，剑没有出鞘，手却始终按在剑柄上。",
      "“别回头。”顾青低声说，“他们已经看见我们了。”",
    ],
  },
  46: {
    title: "夜船",
    paragraphs: [
      "夜船靠岸时，河面上浮着一层薄雾。",
      "沈砚先看见的是船头那盏白灯笼，然后才看见灯下的人。那人穿着一身洗得发白的青衫，正低头擦一枚半旧的玉佩。",
      "顾青的脚步停了一瞬。",
      "很轻的一瞬，但沈砚还是看见了。",
      "“上船。”顾青说。",
      "沈砚没有问那枚玉佩是谁的。他只是把左袖往里收了收，遮住袖口没有干透的血。",
    ],
  },
  47: {
    title: "断臂之后",
    paragraphs: [
      "血从袖口滴下来，落在青石板上，像一串没有写完的省略号。",
      "沈砚把左臂往袖中缩了缩，指节已经发白。他听见身后脚步声逼近，知道血河宗的人没有走远。",
      "“你还能打？”顾青问。",
      "“能。”",
      "沈砚没有回头。他试着抬起左手，骨头里立刻传来一阵钝痛，像有人拿烧红的铁签慢慢搅动。那本古书在识海里翻了一页，纸声很轻，却让他想起一件已经想不起来的事。",
      '<span class="comment-mark" data-comment="这里左臂还断着，不能双手结印。建议改成单手结印，或让顾青替他挡下第一击。">他双手结印，灵力在掌心凝成一道细线。</span>',
      "顾青的眼神变了。",
      "那道细线没有撑过一息，便碎成满掌的血。沈砚踉跄半步，右膝重重跪地，却趁势把断臂藏到身后。",
      "“我说了，能。”",
      "顾青没有拆穿他。他只是把手按在剑柄上，望向夜色里越来越近的火光。",
      "“那就跑。”",
    ],
  },
  48: {
    title: "一只手也能结印",
    paragraphs: [
      "天快亮的时候，沈砚终于承认自己跑不动了。",
      "左臂已经彻底失去知觉，像一截挂在肩上的枯枝。顾青把他按在一棵老树后，抬手示意他别出声。",
      "追兵的火光从坡下掠过，越来越近。",
      "沈砚咬住袖口，用右手掐了一个残缺的印。识海里的古书没有翻页，只是轻轻震了一下。",
      "他忽然想起一个不属于自己的动作：单手持剑，以身作阵。",
      "顾青回头看了他一眼。",
      "那一眼里没有惊讶，只有一种很慢的、终于确认了什么的了然。",
    ],
  },
  49: {
    title: "顾青的试探",
    paragraphs: [
      "顾青没有问他从哪里学来的那招。",
      "他只是把半枚青玉放在石头上，推到沈砚面前。",
      "“你见过这个吗？”",
      "沈砚低头看了一眼。玉上有一道旧裂纹，裂纹里嵌着一点暗红，像干涸的血。",
      "他确实见过。在忘川村那场大火之后，在母亲把他塞进地窖之前。",
      "但他摇了摇头。",
      "顾青看着他，很久没有说话。",
    ],
  },
};

let toastTimer = null;

function initIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message || "操作已完成";
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.classList.remove("show");
  }, 2600);
}

function updateCrumbs(page) {
  const crumbs = document.getElementById("crumbs");
  if (!crumbs) return;
  let html = '<span>我的作品</span><i data-lucide="chevron-right"></i>';
  if (page === "dashboard" || page === "new-project") {
    html += `<strong>${pageLabels[page]}</strong>`;
  } else {
    html += '<strong>仙途：忘川书</strong><i data-lucide="chevron-right"></i>';
    html += `<strong>${pageLabels[page]}</strong>`;
  }
  crumbs.innerHTML = html;
  initIcons();
}

function navigate(page, options = {}) {
  const target = validPages.has(page) ? page : "dashboard";
  document.querySelectorAll(".page").forEach((section) => {
    section.classList.toggle("active", section.dataset.page === target);
  });
  document.querySelectorAll(".nav-item[data-page]").forEach((item) => {
    item.classList.toggle("active", item.dataset.page === target);
  });
  updateCrumbs(target);
  document.title = pageTitles[target] || "墨舟";
  if (!options.keepHash) {
    history.replaceState(null, "", `#${target}`);
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setTab(tab) {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });
  document.querySelectorAll("[data-tab-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.tabPanel === tab);
  });
}

function setNoteTab(tab) {
  document.querySelectorAll("[data-note-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.noteTab === tab);
  });
  document.querySelectorAll("[data-note-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.notePanel === tab);
  });
}

function renderChapter(number) {
  const chapter = chapters[number];
  if (!chapter) return;
  const paper = document.querySelector(".editor-paper");
  const headingNumber = document.querySelector(".chapter-heading span");
  const headingTitle = document.querySelector(".chapter-heading h1");
  if (!paper || !headingNumber || !headingTitle) return;

  headingNumber.textContent = `第 ${number} 章`;
  headingTitle.textContent = chapter.title;
  paper.innerHTML =
    `<div class="chapter-heading"><span>第 ${number} 章</span><h1>${chapter.title}</h1></div>` +
    chapter.paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join("");

  document.querySelectorAll(".chapter-nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.chapter === String(number));
  });
  document.querySelectorAll(".chapter-card").forEach((item) => {
    item.classList.toggle("active", item.dataset.chapter === String(number));
  });

  bindCommentMarks();
  initIcons();
  showToast(`已切换到第 ${number} 章「${chapter.title}」`);
}

function bindCommentMarks() {
  document.querySelectorAll(".comment-mark").forEach((mark) => {
    mark.addEventListener("click", () => {
      showToast(mark.dataset.comment || "编辑批注");
    });
  });
}

function openExport() {
  const modal = document.getElementById("export-modal");
  if (!modal) return;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeExport() {
  const modal = document.getElementById("export-modal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function handleAction(action, element) {
  switch (action) {
    case "toast":
      showToast(element.dataset.message);
      break;
    case "toggle-sidebar":
      document.body.classList.toggle("sidebar-collapsed");
      break;
    case "open-export":
      openExport();
      break;
    case "close-export":
      closeExport();
      break;
    case "fill-idea": {
      const idea = document.getElementById("idea");
      if (idea) {
        idea.value = element.dataset.idea || "";
        idea.focus();
        showToast("灵感已填入，可以继续调整");
      }
      break;
    }
    case "generate-blueprint": {
      const buttons = document.querySelectorAll('[data-action="generate-blueprint"]');
      buttons.forEach((button) => {
        button.disabled = true;
        const label = button.querySelector("span");
        if (label) label.textContent = "正在生成故事蓝图…";
      });
      showToast("正在整理世界规则、人物关系与前三卷主线");
      window.setTimeout(() => {
        buttons.forEach((button) => {
          button.disabled = false;
          const label = button.querySelector("span");
          if (label) label.textContent = "生成故事蓝图";
        });
        navigate("bible");
        showToast("故事蓝图已生成，已进入故事圣经");
      }, 1100);
      break;
    }
    case "toggle-comments":
      document.body.classList.toggle("hide-comments");
      showToast(
        document.body.classList.contains("hide-comments")
          ? "已隐藏编辑批注"
          : "已显示编辑批注"
      );
      break;
    default:
      break;
  }
}

function initNavigation() {
  document.addEventListener("click", (event) => {
    const pageTrigger = event.target.closest("[data-page]");
    if (pageTrigger && !pageTrigger.classList.contains("page")) {
      event.preventDefault();
      navigate(pageTrigger.dataset.page);
      return;
    }

    const actionTrigger = event.target.closest("[data-action]");
    if (actionTrigger) {
      event.preventDefault();
      handleAction(actionTrigger.dataset.action, actionTrigger);
      return;
    }

    const tabTrigger = event.target.closest("[data-tab]");
    if (tabTrigger) {
      event.preventDefault();
      setTab(tabTrigger.dataset.tab);
      return;
    }

    const noteTrigger = event.target.closest("[data-note-tab]");
    if (noteTrigger) {
      event.preventDefault();
      setNoteTab(noteTrigger.dataset.noteTab);
      return;
    }

    const chapterTrigger = event.target.closest("[data-chapter]");
    if (chapterTrigger) {
      event.preventDefault();
      if (chapterTrigger.classList.contains("chapter-card")) {
        navigate("writing");
      }
      renderChapter(chapterTrigger.dataset.chapter);
      return;
    }

    const scopeTrigger = event.target.closest(".scope-segments .seg");
    if (scopeTrigger) {
      event.preventDefault();
      scopeTrigger
        .closest(".scope-segments")
        .querySelectorAll(".seg")
        .forEach((item) => item.classList.toggle("active", item === scopeTrigger));
      showToast(`生成范围已切换为：${scopeTrigger.textContent.trim()}`);
      return;
    }

    const formatTrigger = event.target.closest(".format-card");
    if (formatTrigger) {
      event.preventDefault();
      formatTrigger
        .closest(".format-grid")
        .querySelectorAll(".format-card")
        .forEach((item) => item.classList.toggle("active", item === formatTrigger));
      showToast(`导出格式已选择：${formatTrigger.querySelector("strong").textContent}`);
      return;
    }

    if (event.target.classList.contains("modal-backdrop")) {
      closeExport();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeExport();
    }
  });
}

function initChapterFilter() {
  const input = document.querySelector(".chapter-filter input");
  if (!input) return;
  input.addEventListener("input", () => {
    const query = input.value.trim().toLowerCase();
    document.querySelectorAll(".chapter-nav-item").forEach((item) => {
      const text = item.textContent.toLowerCase();
      item.style.display = text.includes(query) ? "" : "none";
    });
  });
}

function initBudgetRange() {
  const range = document.getElementById("budget");
  const label = document.querySelector(".range-head strong");
  if (!range || !label) return;
  range.addEventListener("input", () => {
    label.textContent = `¥ ${range.value}`;
  });
}

function initEditorInput() {
  const paper = document.querySelector(".editor-paper");
  const counter = document.querySelector(".editor-statusbar span:first-child");
  if (!paper || !counter) return;
  let timer = null;
  paper.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const length = paper.innerText.replace(/\s+/g, "").length;
      counter.innerHTML = `<i data-lucide="type"></i>${length.toLocaleString()} 字`;
      initIcons();
    }, 250);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initNavigation();
  initChapterFilter();
  initBudgetRange();
  initEditorInput();
  bindCommentMarks();
  initIcons();

  const hash = window.location.hash.replace("#", "");
  navigate(validPages.has(hash) ? hash : "dashboard", { keepHash: true });
});
