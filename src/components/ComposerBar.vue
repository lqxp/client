<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "@/composables/useI18n";

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const props = defineProps({
  messenger: { type: Object, required: true }
});

const composerRef = ref<HTMLElement | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const inputRef = ref<HTMLTextAreaElement | null>(null);
const emojiWrapRef = ref<HTMLElement | null>(null);
const cameraVideoRef = ref<HTMLVideoElement | null>(null);
const cameraCanvasRef = ref<HTMLCanvasElement | null>(null);
const pickerOpen = ref(false);
const cameraOpen = ref(false);
const cameraBusy = ref(false);
const cameraError = ref("");
const mobileActionsOpen = ref(false);
const isMobile = ref(typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches);
const cursorPosition = ref(0);
const mentionIndex = ref(0);
const mentionSuppressedStart = ref(-1);
const cameraFacing = ref<"user" | "environment">(
  (typeof localStorage !== "undefined" && (localStorage.getItem("lqxp_camera_facing") as "user" | "environment" | null)) || "environment"
);
let cameraStream: MediaStream | null = null;

const pendingFiles = ref<{ id: string; file: File; preview: string; progress: number }[]>([]);
const uploading = ref(false);
const muteNow = ref(Date.now());
let muteTimer: ReturnType<typeof setInterval> | null = null;

const hasPendingFiles = computed(() => pendingFiles.value.length > 0);
const speakBlockReason = computed(() => props.messenger.speakBlockReason?.(props.messenger.state.activeRoom) || "");
const speakBlocked = computed(() => Boolean(speakBlockReason.value));
const canSend = computed(() => !uploading.value && !speakBlocked.value && (props.messenger.state.messageInput.trim().length > 0 || hasPendingFiles.value) && !!props.messenger.state.activeRoom);
const disabled = computed(() => !props.messenger.state.activeRoom || speakBlocked.value);
const editing = computed(() => !!props.messenger.state.editingMessage);
const composerPlaceholder = computed(() => {
  if (speakBlocked.value) {
    switch (speakBlockReason.value) {
      case "banned": return t('rooms.cannotSpeakBanned');
      case "timeout": return t('rooms.cannotSpeakTimeout');
      case "locked": return t('composer.cannotSpeakHere', { channel: props.messenger.displayRoomName?.(props.messenger.state.activeRoom) || "" });
      default: return t('composer.placeholder');
    }
  }
  if (disabled.value) return t('composer.placeholder');
  return editing.value ? t('composer.editing') : t('composer.placeholder');
});
const mediaDisabled = computed(() => disabled.value || editing.value);
const recording = computed(() => !!props.messenger.state.recording);

function formatMuteRemaining(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

const muteCooldownLabel = computed(() => {
  const roomId = props.messenger.state.activeRoom;
  if (!roomId) return "";
  void muteNow.value;
  const remaining = Number(props.messenger.myTimeoutRemaining?.(roomId) || 0);
  if (remaining <= 0) return "";
  return formatMuteRemaining(remaining);
});
const typingLabel = computed(() => {
  const users = props.messenger.typingUsers?.value || [];
  if (!users.length) return "";
  if (users.length === 1) return t("thread.typingOne", { user: users[0] });
  return t("thread.typingMany", { count: String(users.length) });
});
const mentionSearch = computed(() => {
  const input = inputRef.value;
  const cursor = input?.selectionStart ?? cursorPosition.value ?? 0;
  const beforeCursor = String(props.messenger.state.messageInput || "").slice(0, cursor);
  const match = /(^|[^a-zA-Z0-9_.])@([a-z0-9_.]{0,32})$/i.exec(beforeCursor);
  if (!match) return null;
  return {
    start: beforeCursor.length - match[2].length - 1,
    query: match[2].toLowerCase()
  };
});
const mentionOptions = computed<string[]>(() => {
  if (disabled.value || !mentionSearch.value) return [];
  const query = mentionSearch.value.query;
  const rawRoster = Array.isArray(props.messenger.memberRoster.value)
    ? props.messenger.memberRoster.value
    : [];
  const members = [...new Set<string>(rawRoster
    .map((name: unknown) => String(name || "").trim().toLowerCase())
    .filter((name: string) => Boolean(name)))];
  return members
    .filter((name: string) => !query || name.startsWith(query) || name.includes(query))
    .sort((a: string, b: string) => {
      const aStarts = a.startsWith(query) ? 0 : 1;
      const bStarts = b.startsWith(query) ? 0 : 1;
      return aStarts - bStarts || a.localeCompare(b);
    })
    .slice(0, 8);
});
const mentionOpen = computed(() => mentionOptions.value.length > 0 && mentionSearch.value?.start !== mentionSuppressedStart.value);
const selectedMention = computed<string>(() => mentionOptions.value[Math.min(mentionIndex.value, mentionOptions.value.length - 1)] || "");

function initialsFor(name: string) {
  const clean = String(name || "?").trim();
  const parts = clean.split(/[\s\-_]+/).filter(Boolean).slice(0, 2);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return clean.slice(0, 2).toUpperCase() || "?";
}

function mentionAvatarSrc(username: string) {
  return props.messenger.profileImageSrc?.(props.messenger.profileFor?.(username)?.avatar, "avatar") || "";
}

function syncComposerHeight() {
  const input = inputRef.value;
  if (!input) return;

  input.style.height = "auto";
  const maxHeight = 120;
  const nextHeight = Math.min(maxHeight, input.scrollHeight);
  input.style.height = `${Math.max(32, nextHeight)}px`;
  input.style.overflowY = input.scrollHeight > maxHeight ? "auto" : "hidden";
}

function focusInput(options: { end?: boolean } = {}) {
  const input = inputRef.value;
  if (!input || disabled.value) return;
  input.focus();
  if (!options.end) return;
  const length = input.value.length;
  try { input.setSelectionRange(length, length); } catch { }
}

const EMOJI_CATEGORIES = [
  {
    id: "smileys",
    label: "Smileys & People",
    emojis: [
      "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "🙃",
      "😉", "😊", "😇", "🥰", "😍", "🤩", "😘", "😗", "😚", "😙",
      "😋", "😛", "😜", "🤪", "😝", "🤑", "🤗", "🤭", "🤫", "🤔",
      "🤐", "🤨", "😐", "😑", "😶", "😏", "😒", "🙄", "😬", "🤥",
      "😌", "😔", "😪", "🤤", "😴", "😷", "🤒", "🤕", "🤢", "🤮",
      "🤧", "🥵", "🥶", "🥴", "😵", "🤯", "🤠", "🥳", "😎", "🤓",
      "🧐", "😕", "😟", "🙁", "😮", "😯", "😲", "😳", "🥺", "😦",
      "😧", "😨", "😰", "😥", "😢", "😭", "😱", "😖", "😣", "😞",
      "😓", "😩", "😫", "🥱", "😤", "😡", "😠", "🤬", "😈", "👿",
      "💀", "☠️", "💩", "🤡", "👹", "👺", "👻", "👽", "👾", "🤖",
      "👶", "👧", "🧒", "👦", "👩", "🧑", "👨", "👵", "🧓", "👴",
      "👮", "🕵️", "💂", "👷", "🤴", "👸", "🧙", "🧚", "🧛", "🧜",
      "💃", "🕺", "👫", "👬", "👭", "💏", "💑", "👪"
    ]
  },
  {
    id: "gestures",
    label: "Gestures",
    emojis: [
      "👋", "🤚", "🖐️", "✋", "🖖", "👌", "🤌", "🤏", "✌️", "🤞",
      "🤟", "🤘", "🤙", "👈", "👉", "👆", "🖕", "👇", "☝️", "👍",
      "👎", "✊", "👊", "🤛", "🤜", "👏", "🙌", "👐", "🤲", "🤝",
      "🙏", "✍️", "💅", "🤳", "💪", "🦾", "🦿", "🦵", "🦶", "👂",
      "🦻", "👃", "🧠", "🫀", "🫁", "🦷", "🦴", "👀", "👁️", "👅", "👄"
    ]
  },
  {
    id: "nature",
    label: "Animals & Nature",
    emojis: [
      "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯",
      "🦁", "🐮", "🐷", "🐽", "🐸", "🐵", "🙈", "🙉", "🙊", "🐒",
      "🐔", "🐧", "🐦", "🐤", "🦆", "🦅", "🦉", "🦇", "🐺", "🐗",
      "🐴", "🦄", "🐝", "🐛", "🦋", "🐌", "🐞", "🐜", "🕷️", "🦂",
      "🐢", "🐍", "🦎", "🦖", "🦕", "🐙", "🦑", "🦐", "🦀", "🐡",
      "🐠", "🐟", "🐬", "🐳", "🐋", "🦈", "🌵", "🎄", "🌲", "🌳",
      "🌴", "🌱", "🌿", "🍀", "🍁", "🍂", "🌹", "🌻", "🌼", "🌸", "💐", "🍄"
    ]
  },
  {
    id: "food",
    label: "Food & Drink",
    emojis: [
      "🍏", "🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🫐",
      "🍒", "🍑", "🥭", "🍍", "🥥", "🥝", "🍅", "🍆", "🥑", "🥦",
      "🥬", "🥒", "🌶️", "🌽", "🥕", "🧄", "🧅", "🥔", "🍠", "🥐",
      "🥯", "🍞", "🥖", "🥨", "🧀", "🥚", "🍳", "🧈", "🥞", "🧇",
      "🥓", "🥩", "🍗", "🍖", "🌭", "🍔", "🍟", "🍕", "🥪", "🥙",
      "🌮", "🌯", "🥗", "🥘", "🍝", "🍜", "🍲", "🍛", "🍣", "🍱",
      "🥟", "🍤", "🍙", "🍚", "🍘", "🍥", "🍡", "🍧", "🍨", "🍦",
      "🥧", "🍰", "🎂", "🍮", "🍭", "🍬", "🍫", "🍿", "🍩", "🍪",
      "☕", "🍵", "🍶", "🍾", "🍷", "🍸", "🍹", "🍺", "🍻", "🥂",
      "🥃", "🥤", "🧋", "🧃", "🧉", "🧊"
    ]
  },
  {
    id: "activities",
    label: "Activities & Travel",
    emojis: [
      "⚽", "🏀", "🏈", "⚾", "🎾", "🏐", "🏉", "🎱", "🏓", "🏸",
      "🏒", "🏑", "🏏", "🥅", "⛳", "🏹", "🎣", "🥊", "🥋", "🎽",
      "🛹", "🛼", "🛷", "⛸️", "🎿", "⛷️", "🏂", "🏋️", "🤸", "⛹️",
      "🏇", "🏄", "🏊", "🤽", "🚣", "🧗", "🚵", "🚴", "🏆", "🥇",
      "🥈", "🥉", "🏅", "🎖️", "🎗️", "🎫", "🎟️", "🎪", "🤹", "🎭",
      "🎨", "🎬", "🎤", "🎧", "🎼", "🎹", "🥁", "🎷", "🎺", "🎸",
      "🎻", "🎲", "♟️", "🎯", "🎳", "🎮", "🎰", "🧩",
      "🚗", "🚕", "🚙", "🚌", "🚎", "🏎️", "🚓", "🚑", "🚒", "🚐",
      "🛻", "🚚", "🚛", "🚜", "🛵", "🏍️", "🚲", "🛴", "🛹", "🚡",
      "🚠", "🚟", "🚃", "🚋", "🚞", "🚝", "🚄", "🚅", "🚈", "🚂",
      "🚆", "🚇", "🚊", "🚉", "✈️", "🛫", "🛬", "🛩️", "💺", "🛰️",
      "🚀", "🛸", "🚁", "🛶", "⛵", "🚤", "🛥️", "🛳️", "⛴️", "🚢",
      "⚓", "🗺️", "🌍", "🌎", "🌏", "🗻", "🏕️", "🏖️", "🏜️", "🏝️",
      "🏟️", "🏛️", "🏗️", "🏘️", "🏙️", "🏠", "🏡", "🏢", "🏥", "🏦",
      "🏨", "🏫", "🏬", "🏭", "🏯", "🏰", "💒", "🗼", "🗽", "⛪", "🕌", "⛩️"
    ]
  },
  {
    id: "objects",
    label: "Objects & Symbols",
    emojis: [
      "⌚", "📱", "💻", "⌨️", "🖥️", "🖨️", "🖱️", "🖲️", "🕹️", "💽",
      "💾", "💿", "📀", "📼", "📷", "📸", "📹", "🎥", "📽️", "📞",
      "☎️", "📟", "📠", "📺", "📻", "🎙️", "🎚️", "🎛️", "🧭", "⏱️",
      "⏲️", "⏰", "⌛", "⏳", "📡", "🔋", "🔌", "💡", "🔦", "🕯️",
      "💸", "💵", "💴", "💶", "💷", "🪙", "💰", "💳", "💎", "⚖️",
      "🧰", "🧲", "🔧", "🔨", "⚒️", "🛠️", "⛏️", "🔩", "⚙️", "🧱",
      "⛓️", "🔫", "🧨", "💣", "🏹", "🛡️", "🗡️", "⚔️", "🔪", "🪓",
      "🔒", "🔓", "🔐", "🔑", "🗝️", "⚰️", "⚱️", "🧿", "💄", "💍",
      "👑", "🎩", "🧢", "👒", "🎓", "⛑️", "🪖", "💼", "🎒", "👝", "👛", "👜",
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔",
      "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💟", "💯",
      "💢", "🔥", "✨", "⭐", "🎉", "🎊", "☕", "❗", "❓", "✅",
      "❌", "⭕", "🛑", "⛔", "🚫", "⚠️", "♻️", "➕", "➖", "➗", "✖️"
    ]
  }
];

const EMOJI_NAMES = {
  // Smileys & People
  "😀": "smile grinning face happy",
  "😃": "smile grinning happy face",
  "😄": "smile happy open mouth",
  "😁": "grin smile happy",
  "😆": "laugh smiling",
  "😅": "sweat smile nervous laugh",
  "🤣": "rofl laugh rolling",
  "😂": "joy laugh tears crying happy",
  "🙂": "smile",
  "🙃": "upside face",
  "😉": "wink",
  "😊": "smile blush happy",
  "😇": "angel innocent",
  "🥰": "love hearts smiling",
  "😍": "love heart eyes",
  "🤩": "star eyes wow",
  "😘": "kiss",
  "😗": "kiss",
  "😚": "kiss",
  "😙": "kiss",
  "😋": "yum tasty",
  "😛": "tongue",
  "😜": "wink tongue",
  "🤪": "crazy zany",
  "😝": "tongue playful",
  "🤑": "money rich",
  "🤗": "hug",
  "🤭": "giggle oops",
  "🤫": "shh quiet",
  "🤔": "think hmm",
  "🤐": "zip mouth",
  "🤨": "skeptical raised eyebrow",
  "😐": "neutral",
  "😑": "expressionless",
  "😶": "silent no mouth",
  "😏": "smirk",
  "😒": "unamused",
  "🙄": "roll eyes",
  "😬": "grimace",
  "🤥": "lie liar",
  "😌": "relieved",
  "😔": "sad pensive",
  "😪": "sleepy tired",
  "🤤": "drool",
  "😴": "sleep sleeping",
  "😷": "mask sick",
  "🤒": "sick ill",
  "🤕": "hurt injured",
  "🤢": "nauseated sick",
  "🤮": "vomit puke",
  "🤧": "sneeze",
  "🥵": "hot overheated",
  "🥶": "cold freezing",
  "🥴": "woozy drunk",
  "😵": "dizzy dead",
  "🤯": "explode mind blown",
  "🤠": "cowboy",
  "🥳": "party celebrate birthday",
  "😎": "cool sunglasses",
  "🤓": "nerd",
  "🧐": "monocle",
  "😕": "confused",
  "😟": "worried",
  "🙁": "frown sad",
  "😮": "surprised wow",
  "😯": "surprised",
  "😲": "astonished",
  "😳": "flushed blush",
  "🥺": "pleading puppy",
  "😦": "frown",
  "😧": "anguished",
  "😨": "fearful scared",
  "😰": "anxious sweat",
  "😥": "sad disappointed",
  "😢": "cry tear sad",
  "😭": "cry sob tears bawl",
  "😱": "scream scared",
  "😖": "confounded",
  "😣": "persevere",
  "😞": "disappointed sad",
  "😓": "sweat downcast",
  "😩": "weary tired",
  "😫": "tired exhausted",
  "🥱": "yawning bored",
  "😤": "frustrated triumph",
  "😡": "angry rage pout",
  "😠": "angry mad",
  "🤬": "cursing swear",
  "😈": "devil evil smile",
  "👿": "devil angry",
  "💀": "skull dead skeleton",
  "☠️": "skull crossbones danger",
  "💩": "poop poop shit",
  "🤡": "clown",
  "👹": "ogre monster",
  "👺": "goblin",
  "👻": "ghost halloween",
  "👽": "alien",
  "👾": "alien monster",
  "🤖": "robot",
  // Gestures
  "👋": "wave hi hello bye",
  "🤚": "raised hand back",
  "🖐️": "hand fingers",
  "✋": "hand stop",
  "🖖": "vulcan star trek",
  "👌": "ok perfect",
  "🤌": "pinched fingers italian",
  "🤏": "pinch small",
  "✌️": "peace victory",
  "🤞": "crossed fingers luck",
  "🤟": "love you hand",
  "🤘": "rock devil horns",
  "🤙": "call me",
  "👈": "point left",
  "👉": "point right",
  "👆": "point up",
  "🖕": "middle finger",
  "👇": "point down",
  "☝️": "point up",
  "👍": "thumbs up good yes",
  "👎": "thumbs down no",
  "✊": "fist",
  "👊": "punch fist",
  "👏": "clap applause",
  "🙌": "raised hands celebrate",
  "👐": "open hands",
  "🤲": "palms up",
  "🤝": "handshake deal",
  "🙏": "pray please thanks",
  "💪": "muscle strong power",
  "👀": "eyes look",
  "👁️": "eye",
  "👅": "tongue",
  "👄": "lips mouth",
  // Animals
  "🐶": "dog puppy",
  "🐱": "cat kitten",
  "🐭": "mouse",
  "🐹": "hamster",
  "🐰": "rabbit bunny",
  "🦊": "fox",
  "🐻": "bear",
  "🐼": "panda",
  "🐨": "koala",
  "🐯": "tiger",
  "🦁": "lion",
  "🐮": "cow",
  "🐷": "pig",
  "🐸": "frog",
  "🐵": "monkey",
  "🐔": "chicken",
  "🐧": "penguin",
  "🐦": "bird",
  "🦆": "duck",
  "🦅": "eagle",
  "🦉": "owl",
  "🦇": "bat",
  "🐺": "wolf",
  "🐴": "horse",
  "🦄": "unicorn",
  "🐝": "bee",
  "🐛": "bug caterpillar",
  "🦋": "butterfly",
  "🐌": "snail",
  "🐞": "ladybug",
  "🐜": "ant",
  "🕷️": "spider",
  "🦂": "scorpion",
  "🐢": "turtle",
  "🐍": "snake",
  "🦖": "dinosaur t-rex",
  "🦕": "dinosaur",
  "🐙": "octopus",
  "🦑": "squid",
  "🦀": "crab",
  "🐟": "fish",
  "🐬": "dolphin",
  "🐳": "whale",
  "🐋": "whale",
  "🦈": "shark",
  "🌵": "cactus",
  "🎄": "christmas tree",
  "🌲": "tree",
  "🌴": "palm tree",
  "🌹": "rose flower",
  "🌻": "sunflower",
  "🌸": "cherry blossom flower",
  "🍀": "clover luck",
  "🍁": "maple leaf",
  "🍄": "mushroom",
  // Food
  "🍏": "apple",
  "🍎": "apple red",
  "🍊": "orange",
  "🍋": "lemon",
  "🍌": "banana",
  "🍉": "watermelon",
  "🍇": "grapes",
  "🍓": "strawberry",
  "🍒": "cherry",
  "🍑": "peach",
  "🍍": "pineapple",
  "🥥": "coconut",
  "🍅": "tomato",
  "🍆": "eggplant",
  "🥑": "avocado",
  "🥕": "carrot",
  "🌽": "corn",
  "🍞": "bread",
  "🥖": "baguette",
  "🧀": "cheese",
  "🥚": "egg",
  "🍳": "cooking fry egg",
  "🥞": "pancakes",
  "🧇": "waffle",
  "🥓": "bacon",
  "🥩": "steak meat",
  "🍗": "chicken leg",
  "🍔": "burger hamburger",
  "🍟": "fries",
  "🍕": "pizza",
  "🥪": "sandwich",
  "🥗": "salad",
  "🍝": "pasta spaghetti",
  "🍜": "noodles ramen",
  "🍣": "sushi",
  "🍙": "rice ball",
  "🍚": "rice",
  "🍦": "ice cream",
  "🍰": "cake",
  "🎂": "birthday cake",
  "🍩": "donut",
  "🍪": "cookie",
  "🍫": "chocolate",
  "🍿": "popcorn",
  "☕": "coffee",
  "🍵": "tea",
  "🍷": "wine",
  "🍺": "beer",
  "🍻": "beers cheers",
  "🥂": "champagne toast",
  "🥤": "soda drink",
  // Activities & Travel
  "⚽": "soccer football ball",
  "🏀": "basketball",
  "🏈": "football american",
  "⚾": "baseball",
  "🎾": "tennis",
  "🏓": "ping pong",
  "🎮": "video game",
  "🎯": "dart target",
  "🎳": "bowling",
  "🏆": "trophy winner",
  "🥇": "gold medal",
  "🥈": "silver medal",
  "🥉": "bronze medal",
  "🎨": "art palette",
  "🎬": "cinema movie",
  "🎤": "microphone sing",
  "🎧": "headphones music",
  "🎸": "guitar",
  "🎹": "piano keyboard",
  "🎺": "trumpet",
  "🎻": "violin",
  "🚗": "car",
  "🚕": "taxi",
  "🚌": "bus",
  "🚓": "police car",
  "🚑": "ambulance",
  "🚒": "fire truck",
  "🚲": "bicycle bike",
  "🏍️": "motorcycle motorbike",
  "✈️": "airplane plane",
  "🚀": "rocket",
  "🛸": "ufo flying saucer",
  "🚁": "helicopter",
  "⛵": "sailboat boat",
  "🚢": "ship",
  "🗺️": "map",
  "🌍": "earth globe world",
  "🌎": "earth globe",
  "🌏": "earth globe",
  "🏠": "house home",
  "🏡": "house home",
  "🏢": "building office",
  "🏥": "hospital",
  "🏦": "bank",
  "🏫": "school",
  "🏰": "castle",
  "⛪": "church",
  "🕌": "mosque",
  // Objects & Symbols
  "⌚": "watch",
  "📱": "phone smartphone mobile",
  "💻": "computer laptop",
  "⌨️": "keyboard",
  "🖥️": "computer desktop",
  "📷": "camera",
  "📸": "camera photo",
  "📹": "video camera",
  "🎥": "camera movie",
  "📺": "tv television",
  "📻": "radio",
  "⏰": "alarm clock",
  "⏳": "hourglass time",
  "📡": "satellite antenna",
  "🔋": "battery",
  "💡": "light bulb idea",
  "💰": "money cash",
  "💳": "credit card",
  "💎": "diamond gem",
  "🔧": "wrench tool",
  "🔨": "hammer",
  "🔑": "key",
  "🔒": "lock locked",
  "🔓": "unlock unlocked",
  "💄": "lipstick makeup",
  "💍": "ring",
  "👑": "crown king",
  "🎓": "graduation cap",
  "💼": "briefcase work",
  "🎒": "backpack school",
  "❤️": "heart love red",
  "🧡": "heart orange",
  "💛": "heart yellow",
  "💚": "heart green",
  "💙": "heart blue",
  "💜": "heart purple",
  "🖤": "heart black",
  "🤍": "heart white",
  "💔": "broken heart",
  "💕": "two hearts love",
  "💓": "beating heart",
  "💗": "growing heart",
  "💖": "sparkling heart",
  "💘": "heart arrow love",
  "💯": "hundred perfect score",
  "💢": "anger symbol",
  "🔥": "fire hot flame",
  "✨": "sparkles star",
  "⭐": "star",
  "🎉": "party celebration confetti",
  "🎊": "confetti celebration",
  "❗": "exclamation",
  "❓": "question",
  "✅": "check mark done",
  "❌": "cross no wrong",
  "⚠️": "warning danger",
  "♻️": "recycle",
  "➕": "plus",
  "➖": "minus",
  "➗": "divide",
  "✖️": "multiply"
};

const emojiSearch = ref("");
const emojiCategory = ref("smileys");

function emojiMatchesQuery(emoji: string, q: string): boolean {
  if (!q) return true;
  if (emoji.toLowerCase().includes(q)) return true;
  const names = EMOJI_NAMES[emoji];
  return Boolean(names && names.includes(q));
}

const filteredEmojiCategories = computed(() => {
  const q = emojiSearch.value.trim().toLowerCase();
  if (!q) return EMOJI_CATEGORIES;
  return EMOJI_CATEGORIES
    .map((cat) => ({
      ...cat,
      emojis: cat.emojis.filter((e) => emojiMatchesQuery(e, q)),
    }))
    .filter((cat) => cat.emojis.length > 0);
});

const activeEmojiCategory = computed(() => {
  return EMOJI_CATEGORIES.find((c) => c.id === emojiCategory.value) || EMOJI_CATEGORIES[0];
});

function pastedExtension(mimeType) {
  const type = String(mimeType || "").toLowerCase().split(";")[0];
  const known = {
    "application/gzip": "gz",
    "application/pdf": "pdf",
    "application/zip": "zip",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "text/plain": "txt",
    "video/mp4": "mp4",
    "video/webm": "webm"
  };
  if (known[type]) return known[type];
  const subtype = type.includes("/") ? type.split("/").pop() : "";
  const clean = String(subtype || "").replace(/[^a-z0-9]/g, "");
  return clean || "bin";
}

function namePastedFile(file: File, index: number) {
  if (file.name) return file;
  const filename = `pasted-${Date.now()}-${index + 1}.${pastedExtension(file.type)}`;
  try {
    return new File([file], filename, {
      type: file.type || "application/octet-stream",
      lastModified: file.lastModified || Date.now()
    });
  } catch {
    return file;
  }
}

function filesFromClipboard(event: ClipboardEvent): File[] {
  const clipboard = event.clipboardData;
  if (!clipboard) return [];

  const directFiles = Array.from(clipboard.files || []);
  const files = directFiles.length
    ? directFiles
    : Array.from((clipboard.items || []) as DataTransferItemList)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));

  return files.map(namePastedFile);
}

function isEditableElement(element: Element | null) {
  if (!element || element === document.body || element === document.documentElement) return false;
  if (element instanceof HTMLElement && element.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
}

async function onPaste(event: ClipboardEvent) {
  if (mediaDisabled.value || recording.value) return;
  const files = filesFromClipboard(event);
  if (!files.length) return;

  const target = event.target;
  const isComposerPaste = target instanceof Node && !!composerRef.value?.contains(target);
  if (!isComposerPaste && isEditableElement(document.activeElement)) return;

  event.preventDefault();
  pickerOpen.value = false;
  addPendingFiles(files);
}

async function send() {
  if (!canSend.value) return;

  // Upload pending attachments with progress before/alongside the text.
  const files = pendingFiles.value.map((f) => ({ ...f }));
  if (files.length) {
    uploading.value = true;
  }

  try {
    const text = props.messenger.state.messageInput.trim();

    if (files.length === 0) {
      // Text-only message.
      if (text) props.messenger.sendChat();
      props.messenger.setTyping?.(false);
      return;
    }

    for (let i = 0; i < files.length; i++) {
      const item = files[i];
      const target = pendingFiles.value.find((f) => f.id === item.id);
      // Attach the text to the last file so text and image(s) ship as a single message.
      const caption = i === files.length - 1 ? text : "";
      await props.messenger.sendAttachment(item.file, caption, (pct: number) => {
        if (target) target.progress = pct;
      });
      if (target) {
        URL.revokeObjectURL(target.preview);
        pendingFiles.value = pendingFiles.value.filter((f) => f.id !== item.id);
      }
    }

    props.messenger.state.messageInput = "";
    props.messenger.setTyping?.(false);
  } finally {
    uploading.value = false;
    nextTick(() => focusInput());
  }
}

function syncCursor(options: { resetMentionIndex?: boolean } = {}) {
  const input = inputRef.value;
  cursorPosition.value = input?.selectionStart ?? String(props.messenger.state.messageInput || "").length;
  if (options.resetMentionIndex ?? true) mentionIndex.value = 0;
  props.messenger.setTyping?.(Boolean(String(props.messenger.state.messageInput || "").trim()));
  syncComposerHeight();
}

function onComposerClick() {
  syncCursor();
}

function onComposerContainerClick(event: MouseEvent) {
  const target = event.target as HTMLElement;
  if (target.closest("button")) return;
  focusInput();
  syncCursor();
}

function onComposerKeyup() {
  syncCursor({ resetMentionIndex: !mentionOpen.value });
}

async function insertMention(username: string) {
  const target = String(username || "").trim().toLowerCase();
  const search = mentionSearch.value;
  if (!target || !search) return;

  const input = inputRef.value;
  const current = String(props.messenger.state.messageInput || "");
  const cursor = input?.selectionEnd ?? cursorPosition.value ?? current.length;
  const before = current.slice(0, search.start);
  const after = current.slice(cursor);
  const spacer = after && !/^\s/.test(after) ? " " : "";
  const next = `${before}@${target} ${spacer}${after}`.slice(0, props.messenger.MESSAGE_LIMIT || 2000);
  const nextCursor = Math.min(next.length, before.length + target.length + 2);

  props.messenger.state.messageInput = next;
  mentionIndex.value = 0;
  mentionSuppressedStart.value = -1;
  await nextTick();
  inputRef.value?.focus();
  try { inputRef.value?.setSelectionRange(nextCursor, nextCursor); } catch { }
  cursorPosition.value = nextCursor;
}

function onComposerKeydown(event: KeyboardEvent) {
  if (mentionOpen.value && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) {
    event.preventDefault();
    if (event.key === "ArrowDown") {
      mentionIndex.value = (mentionIndex.value + 1) % mentionOptions.value.length;
    } else if (event.key === "ArrowUp") {
      mentionIndex.value = (mentionIndex.value - 1 + mentionOptions.value.length) % mentionOptions.value.length;
    } else if (event.key === "Enter" || event.key === "Tab") {
      const mention = selectedMention.value;
      insertMention(mention).then(() => {
        syncCursor();
        mentionSuppressedStart.value = mentionSearch.value?.start ?? 0;
      });
    } else if (event.key === "Escape") {
      mentionIndex.value = 0;
      mentionSuppressedStart.value = mentionSearch.value?.start ?? -1;
    }
    return;
  }

  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    send();
  }
}

function pickFile() {
  if (mediaDisabled.value) return;
  mobileActionsOpen.value = false;
  fileInputRef.value?.click();
}

function renameUploadFile(file: File): File {
  try {
    return new File([file], props.messenger.randomUploadFilename(file.name), {
      type: file.type || "application/octet-stream",
      lastModified: file.lastModified || Date.now(),
    });
  } catch {
    return file;
  }
}

function addPendingFiles(files: File[]) {
  for (const file of files) {
    const finalFile = props.messenger.state.renameUploadsRandomly
      ? renameUploadFile(file)
      : file;
    pendingFiles.value.push({
      id: crypto.randomUUID(),
      file: finalFile,
      preview: URL.createObjectURL(finalFile),
      progress: 0,
    });
  }
}

// Exposed so the conversation view can feed files dropped anywhere over it.
defineExpose({ addFiles: addPendingFiles });

function removePendingFile(id: string) {
  const item = pendingFiles.value.find((f) => f.id === id);
  if (item) URL.revokeObjectURL(item.preview);
  pendingFiles.value = pendingFiles.value.filter((f) => f.id !== id);
}

function clearPendingFiles() {
  for (const item of pendingFiles.value) URL.revokeObjectURL(item.preview);
  pendingFiles.value = [];
}

async function onFile(event: Event) {
  const target = event.target as HTMLInputElement;
  const files = Array.from(target.files || []);
  addPendingFiles(files);
  target.value = "";
  nextTick(() => focusInput());
}

async function pickCamera() {
  if (mediaDisabled.value || cameraOpen.value) return;
  mobileActionsOpen.value = false;
  pickerOpen.value = false;
  cameraError.value = "";
  cameraBusy.value = false;
  cameraOpen.value = true;
  await nextTick();
  await startCameraStream();
}

async function startCameraStream() {
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraError.value = "Camera is not available in this browser.";
    return;
  }

  stopCameraStream();

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: cameraFacing.value
      },
      audio: false
    });
    if (cameraVideoRef.value) {
      cameraVideoRef.value.srcObject = cameraStream;
      await cameraVideoRef.value.play().catch(() => { });
    }
  } catch (error) {
    cameraError.value = error instanceof Error ? error.message : "Could not open camera.";
    stopCameraStream();
  }
}

function switchCamera() {
  cameraFacing.value = cameraFacing.value === "environment" ? "user" : "environment";
  try { localStorage.setItem("lqxp_camera_facing", cameraFacing.value); } catch { }
  startCameraStream();
}

function startHold() {
  if (mediaDisabled.value || recording.value) return;
  props.messenger.startRecordingVoiceMemo();
}

function endHold() {
  if (!recording.value) return;
  props.messenger.stopRecordingVoiceMemo(false);
}

function cancelHold() {
  if (!recording.value) return;
  props.messenger.stopRecordingVoiceMemo(true);
}

function startMobileRecording() {
  if (mediaDisabled.value || recording.value) return;
  mobileActionsOpen.value = false;
  props.messenger.startRecordingVoiceMemo();
}

function togglePicker() {
  if (disabled.value) return;
  pickerOpen.value = !pickerOpen.value;
}

function toggleMobileActions() {
  if (disabled.value) return;
  pickerOpen.value = false;
  mobileActionsOpen.value = !mobileActionsOpen.value;
}

async function insertEmoji(emoji: string) {
  pickerOpen.value = false;
  const input = inputRef.value;
  const current = props.messenger.state.messageInput || "";

  if (!input) {
    props.messenger.state.messageInput = current + emoji;
    return;
  }

  const start = input.selectionStart ?? current.length;
  const end = input.selectionEnd ?? current.length;
  const before = current.slice(0, start);
  const after = current.slice(end);
  let next = before + emoji + after;
  const limit = props.messenger.MESSAGE_LIMIT || 2000;
  if (next.length > limit) next = next.slice(0, limit);
  props.messenger.state.messageInput = next;

  await nextTick();
  input.focus();
  const pos = Math.min(next.length, before.length + emoji.length);
  try { input.setSelectionRange(pos, pos); } catch { }
}

function onDocPointerDown(event: PointerEvent) {
  if (!(event.target instanceof Node)) return;
  if (pickerOpen.value && emojiWrapRef.value && !emojiWrapRef.value.contains(event.target)) {
    pickerOpen.value = false;
  }
  if (composerRef.value && !composerRef.value.contains(event.target)) {
    mentionIndex.value = 0;
    mentionSuppressedStart.value = mentionSearch.value?.start ?? -1;
  }
}

function onDocKey(event: KeyboardEvent) {
  if (pickerOpen.value && event.key === "Escape") pickerOpen.value = false;
  if (mobileActionsOpen.value && event.key === "Escape") mobileActionsOpen.value = false;
  if (cameraOpen.value && event.key === "Escape") closeCamera();
}

function onResize() {
  isMobile.value = typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches;
  syncComposerHeight();
}

function stopCameraStream() {
  if (cameraStream) {
    for (const track of cameraStream.getTracks()) track.stop();
    cameraStream = null;
  }
  if (cameraVideoRef.value) cameraVideoRef.value.srcObject = null;
}

function closeCamera() {
  stopCameraStream();
  cameraOpen.value = false;
  cameraBusy.value = false;
  cameraError.value = "";
  nextTick(() => focusInput());
}

async function capturePhoto() {
  const video = cameraVideoRef.value;
  const canvas = cameraCanvasRef.value;
  if (!video || !canvas || cameraBusy.value) return;

  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;
  if (!width || !height) {
    cameraError.value = "Camera is not ready yet.";
    return;
  }

  cameraBusy.value = true;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    cameraError.value = "Could not capture photo.";
    cameraBusy.value = false;
    return;
  }
  ctx.drawImage(video, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) {
    cameraError.value = "Could not capture photo.";
    cameraBusy.value = false;
    return;
  }

  const file = new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" });
  addPendingFiles([file]);
  closeCamera();
}

watch(() => props.messenger.state.activeRoom, () => {
  pickerOpen.value = false;
  mobileActionsOpen.value = false;
  mentionIndex.value = 0;
  mentionSuppressedStart.value = -1;
  nextTick(() => {
    syncComposerHeight();
  });
});

function onInput() {
  mentionSuppressedStart.value = -1;
  syncCursor();
}

watch(() => props.messenger.state.messageInput, () => {
  nextTick(() => syncComposerHeight());
});

watch(() => props.messenger.state.editingMessage?.messageId || "", (messageId) => {
  if (!messageId) return;
  nextTick(() => focusInput({ end: true }));
});

watch(() => props.messenger.state.replyingTo?.messageId || "", (messageId) => {
  if (!messageId) return;
  nextTick(() => focusInput());
});

watch(recording, (active) => {
  if (!active) return;
  pickerOpen.value = false;
  mobileActionsOpen.value = false;
});

onMounted(() => {
  document.addEventListener("pointerdown", onDocPointerDown);
  document.addEventListener("keydown", onDocKey);
  window.addEventListener("resize", onResize);
  document.addEventListener("paste", onPaste);
  muteTimer = setInterval(() => {
    muteNow.value = Date.now();
  }, 1000);
  nextTick(() => {
    syncComposerHeight();
  });
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocPointerDown);
  document.removeEventListener("keydown", onDocKey);
  window.removeEventListener("resize", onResize);
  document.removeEventListener("paste", onPaste);
  if (muteTimer) clearInterval(muteTimer);
  muteTimer = null;
  stopCameraStream();
});
</script>

<template>
  <footer ref="composerRef" class="composer">
    <div v-if="messenger.state.recording" class="voice-recorder">
      <div class="voice-recorder__pulse"></div>
      <span>{{ t('composer.recording') }}</span>
      <div class="voice-recorder__actions">
        <button type="button" class="btn--ghost" @click="cancelHold">{{ t('composer.recordCancel') }}</button>
        <button type="button" class="btn btn--send" @click="endHold">{{ t('composer.recordSend') }}</button>
      </div>
    </div>

    <template v-else>
      <div v-if="hasPendingFiles" class="composer__attachments">
        <div
          v-for="item in pendingFiles"
          :key="item.id"
          class="composer__attachment"
        >
          <img v-if="item.file.type.startsWith('image/')" :src="item.preview" alt="" class="composer__attachment-thumb" />
          <div v-else class="composer__attachment-thumb composer__attachment-thumb--file">
            <svg viewBox="0 0 24 24"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M13 2v7h7"/></svg>
          </div>
          <div class="composer__attachment-meta">
            <span class="composer__attachment-name">{{ item.file.name }}</span>
            <div v-if="uploading" class="composer__attachment-progress">
              <span class="composer__attachment-progress-bar" :style="{ width: `${item.progress}%` }"></span>
            </div>
          </div>
          <button v-if="!uploading" type="button" class="icon-btn composer__attachment-remove" :aria-label="t('composer.removeAttachment')" @click="removePendingFile(item.id)">
            <svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
      </div>

      <div class="composer__topline">
        <div v-if="typingLabel" class="typing-indicator composer__typing-indicator" aria-live="polite">{{ typingLabel }}
        </div>
        <div v-if="messenger.state.editingMessage" class="reply-draft edit-draft">
          <div>
            <span class="reply-draft__label">{{ t('composer.editing') }}</span>
            <span class="reply-draft__text">{{ messenger.state.editingMessage.text }}</span>
          </div>
          <button type="button" class="icon-btn" :aria-label="t('composer.cancelEdit')"
            @click="messenger.cancelEditMessage">
            <svg viewBox="0 0 24 24">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div v-else-if="messenger.state.replyingTo" class="reply-draft">
          <div>
            <span class="reply-draft__label">{{ t('composer.replyingTo') }} {{ messenger.state.replyingTo.username ||
              t('message.reply') }}</span>
            <span class="reply-draft__text">{{ messenger.state.replyingTo.text }}</span>
          </div>
          <button type="button" class="icon-btn" :aria-label="t('composer.cancelReply')" @click="messenger.cancelReply">
            <svg viewBox="0 0 24 24">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div v-if="muteCooldownLabel" class="composer__mute-cooldown">
          <svg class="composer__mute-cooldown-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="13" r="8" />
            <path d="M12 9v4l2 2" />
            <path d="M9 2h6" />
          </svg>
          <span>{{ muteCooldownLabel }}</span>
        </div>
      </div>
      <input ref="fileInputRef" type="file" multiple style="display: none" @change="onFile" />
      <div class="composer__mobile-actions">
        <button class="icon-btn composer__more" type="button" aria-label="More message actions"
          :aria-expanded="mobileActionsOpen" :disabled="disabled" @click="toggleMobileActions">
          <svg viewBox="0 0 24 24">
            <circle cx="5" cy="12" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="19" cy="12" r="1.8" />
          </svg>
        </button>

        <Teleport to="body">
          <div v-if="mobileActionsOpen" class="composer__actions-backdrop" @click.self="mobileActionsOpen = false">
            <div class="composer__actions-pop" role="menu" @click.stop>
              <div class="composer__actions-header">
                <strong>{{ t('composer.attachFile') }}</strong>
              </div>
              <button type="button" role="menuitem" :disabled="mediaDisabled" @click="pickFile">
                <svg viewBox="0 0 24 24">
                  <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 1 1 5.66 5.66l-9.2 9.19a2 2 0 1 1-2.83-2.83L14.83 7" />
                </svg>
                <span>{{ t('composer.attachFile') }}</span>
              </button>
              <button type="button" role="menuitem" :disabled="mediaDisabled" @click="startMobileRecording">
                <svg viewBox="0 0 24 24">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M19 10a7 7 0 0 1-14 0" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
                <span>{{ t('composer.holdToRecord') }}</span>
              </button>
              <button type="button" role="menuitem" :disabled="mediaDisabled" @click="pickCamera">
                <svg viewBox="0 0 24 24">
                  <path d="M4 7h3l1.4-2h7.2L17 7h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
                  <circle cx="12" cy="13" r="3.5" />
                </svg>
                <span>{{ t('camera.title') }}</span>
              </button>
              <div class="composer__actions-separator" aria-hidden="true"></div>
              <button type="button" class="composer__actions-cancel" role="menuitem" @click="mobileActionsOpen = false">
                <span>{{ t('message.cancel') }}</span>
              </button>
            </div>
          </div>
        </Teleport>
      </div>

      <div class="composer__input" :class="{ 'composer__input--streamer-blur': messenger.state.streamerMode, 'composer__input--disabled': speakBlocked }"
        @click="onComposerContainerClick">
        <button v-if="!isMobile" class="icon-btn composer__desktop-action composer__attach" type="button" :aria-label="t('composer.attachFile')"
          :disabled="mediaDisabled" @click="pickFile">
          <svg viewBox="0 0 24 24">
            <path
              d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 1 1 5.66 5.66l-9.2 9.19a2 2 0 1 1-2.83-2.83L14.83 7" />
          </svg>
        </button>

        <textarea ref="inputRef" v-model="messenger.state.messageInput" :maxlength="messenger.MESSAGE_LIMIT" rows="1"
          :placeholder="composerPlaceholder" :disabled="disabled" autocomplete="off" spellcheck="false" @input="onInput"
          @click="onComposerClick" @keyup="onComposerKeyup" @keydown="onComposerKeydown"></textarea>

        <button class="icon-btn composer__desktop-action" type="button" :aria-label="t('camera.title')"
          :disabled="mediaDisabled" @click="pickCamera">
          <svg viewBox="0 0 24 24">
            <path d="M4 7h3l1.4-2h7.2L17 7h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
            <circle cx="12" cy="13" r="3.5" />
          </svg>
        </button>

        <button v-if="!canSend" class="icon-btn composer__mic composer__desktop-action" type="button"
          :aria-label="t('composer.holdToRecord')" :disabled="mediaDisabled" @mousedown.prevent="startHold"
          @mouseup.prevent="endHold" @mouseleave="endHold" @touchstart.prevent="startHold"
          @touchend.prevent="endHold" @touchcancel.prevent="cancelHold">
          <svg viewBox="0 0 24 24">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10a7 7 0 0 1-14 0" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </button>

        <div v-if="mentionOpen" class="mention-picker" role="listbox" aria-label="Mention suggestions">
          <button v-for="(username, index) in mentionOptions" :key="username" type="button" class="mention-picker__item"
            :class="{ 'is-active': index === mentionIndex }" role="option" :aria-selected="index === mentionIndex"
            @mousedown.prevent="insertMention(username)">
            <span class="mention-picker__avatar" :class="mentionAvatarSrc(username) ? 'mention-picker__avatar--image' : `avatar--${messenger.accentFor(username)}`">
              <img v-if="mentionAvatarSrc(username)" :src="mentionAvatarSrc(username)" alt="" />
              <template v-else>{{ initialsFor(username) }}</template>
            </span>
            <span class="mention-picker__name">@{{ username }}</span>
          </button>
        </div>
        <span class="composer__emoji-wrap" ref="emojiWrapRef">
          <button class="icon-btn" type="button" :aria-label="t('composer.emoji')" :aria-expanded="pickerOpen"
            :class="{ 'is-active': pickerOpen }" :disabled="disabled" @click.prevent="togglePicker">
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" />
              <path d="M8 14s1.5 2 4 2 4-2 4-2" />
              <line x1="9" y1="9" x2="9.01" y2="9" />
              <line x1="15" y1="9" x2="15.01" y2="9" />
            </svg>
          </button>

          <div v-if="pickerOpen" class="emoji-picker" role="menu" aria-label="Emoji picker">
            <div class="emoji-picker__search">
              <input
                v-model="emojiSearch"
                type="text"
                class="emoji-picker__search-input"
                :placeholder="t('composer.emojiSearch')"
                autocomplete="off"
                spellcheck="false"
              />
            </div>

            <div class="emoji-picker__tabs" role="tablist">
              <button
                v-for="cat in EMOJI_CATEGORIES"
                :key="cat.id"
                type="button"
                class="emoji-picker__tab"
                :class="{ 'is-active': emojiCategory === cat.id }"
                role="tab"
                :aria-selected="emojiCategory === cat.id"
                :aria-label="cat.label"
                :title="cat.label"
                @click="emojiCategory = cat.id"
              >{{ cat.emojis[0] }}</button>
            </div>

            <div v-if="emojiSearch.trim()" class="emoji-picker__results">
              <template v-for="cat in filteredEmojiCategories" :key="cat.id">
                <div class="emoji-picker__section-label">{{ cat.label }}</div>
                <div class="emoji-picker__grid">
                  <button
                    v-for="emoji in cat.emojis"
                    :key="emoji"
                    type="button"
                    class="emoji-picker__cell"
                    :aria-label="emoji"
                    @click="insertEmoji(emoji)"
                  >{{ emoji }}</button>
                </div>
              </template>
            </div>

            <div v-else class="emoji-picker__results">
              <div class="emoji-picker__section-label">{{ activeEmojiCategory.label }}</div>
              <div class="emoji-picker__grid">
                <button
                  v-for="emoji in activeEmojiCategory.emojis"
                  :key="emoji"
                  type="button"
                  class="emoji-picker__cell"
                  :aria-label="emoji"
                  @click="insertEmoji(emoji)"
                >{{ emoji }}</button>
              </div>
            </div>
          </div>
        </span>

        <button v-if="canSend" class="icon-btn composer__send" type="button" :aria-label="t('composer.send')"
          @click="send">
          <svg viewBox="0 0 24 24">
            <path d="m22 2-7 20-4-9-9-4 20-7Z" />
          </svg>
        </button>
      </div>
    </template>
  </footer>

  <Teleport to="body">
    <div v-if="cameraOpen" class="camera-modal" role="dialog" aria-modal="true" :aria-label="t('camera.title')">
      <div class="camera-modal__panel">
        <header class="camera-modal__head">
          <span>{{ t('camera.title') }}</span>
          <div class="camera-modal__head-actions">
            <button type="button" class="icon-btn" :aria-label="t('camera.switch')" @click="switchCamera">
              <svg viewBox="0 0 24 24">
                <path d="M20 7h-5l-1.5-2h-3L9 7H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Z" />
                <path d="M12 18a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
                <path d="m7 3 2 2" />
                <path d="m17 3-2 2" />
              </svg>
            </button>
            <button type="button" class="icon-btn" :aria-label="t('camera.close')" @click="closeCamera">
              <svg viewBox="0 0 24 24">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </header>

        <div class="camera-modal__preview">
          <video ref="cameraVideoRef" autoplay muted playsinline></video>
          <div v-if="cameraError" class="camera-modal__error">{{ cameraError }}</div>
        </div>

        <canvas ref="cameraCanvasRef" class="sr-only"></canvas>

        <div class="camera-modal__actions">
          <button type="button" class="btn" @click="closeCamera">{{ t('camera.cancel') }}</button>
          <button type="button" class="btn btn--primary" :disabled="cameraBusy || !!cameraError" @click="capturePhoto">
            {{ cameraBusy ? "..." : t('camera.capture') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
