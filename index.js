const TelegramBot = require('node-telegram-bot-api');

// این دو تا از متغیرهای محیطی (Environment Variables) که توی Railway ست می‌کنید خونده می‌شن
const TOKEN = process.env.BOT_TOKEN;
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME; // مثلا: @my_channel

if (!TOKEN || !CHANNEL_USERNAME) {
  console.error('BOT_TOKEN و CHANNEL_USERNAME باید توی Environment Variables ست بشن.');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

// --- حافظه موقت کاربران (in-memory) ---
// نکته: این با هر ری‌استارت سرویس پاک می‌شه. برای شروع کار کافیه؛
// اگه بعدا خواستید دائمی بشه، باید یک دیتابیس واقعی (مثل Railway Postgres) اضافه کنیم.
const users = new Map(); // userId -> { currentQuestion, scores }

function getUser(userId) {
  if (!users.has(userId)) {
    users.set(userId, { currentQuestion: -1, scores: {} });
  }
  return users.get(userId);
}

// --- تست استعداد شغلی (مدل هالند RIASEC) ---
const CATEGORY_NAMES = {
  R: 'واقع‌گرا (عملی)',
  I: 'پژوهشگر (تحلیلی)',
  A: 'هنری (خلاق)',
  S: 'اجتماعی',
  E: 'سازمانی (رهبری)',
  C: 'قراردادی (منظم)',
};

const QUESTIONS = [
  { cat: 'R', text: 'از کار با دست، ابزار یا ساخت و تعمیر چیزها لذت می‌برم.' },
  { cat: 'R', text: 'ترجیح می‌دم بیرون از دفتر و در فضای باز کار کنم تا پشت میز.' },
  { cat: 'R', text: 'یادگیری یک مهارت فنی برام جذاب‌تر از خوندن تئوریه.' },

  { cat: 'I', text: 'حل کردن یک مسئله پیچیده برام مثل یک بازی سرگرم‌کننده‌ست.' },
  { cat: 'I', text: 'دوست دارم بدونم «چرا» یک چیز اونجوریه که هست.' },
  { cat: 'I', text: 'ساعت‌ها تحقیق کردن درباره یک موضوع خستم نمی‌کنه.' },

  { cat: 'A', text: 'وقتی می‌تونم چیزی رو به سلیقه خودم و خلاقانه انجام بدم، بیشتر لذت می‌برم.' },
  { cat: 'A', text: 'نوشتن، طراحی، موسیقی یا هر شکل دیگه‌ای از هنر برام جذابه.' },
  { cat: 'A', text: 'از قوانین سفت‌وسخت و روتین ثابت خوشم نمیاد.' },

  { cat: 'S', text: 'کمک کردن یا آموزش دادن به دیگران برام رضایت‌بخشه.' },
  { cat: 'S', text: 'ترجیح می‌دم توی یک تیم کار کنم تا تنها.' },
  { cat: 'S', text: 'گوش دادن به مشکلات دیگران و همدلی کردن برام راحته.' },

  { cat: 'E', text: 'دوست دارم رهبری یک گروه یا پروژه رو به عهده بگیرم.' },
  { cat: 'E', text: 'متقاعد کردن دیگران برای یک ایده یا محصول برام هیجان‌انگیزه.' },
  { cat: 'E', text: 'ریسک کردن برای یک فرصت بزرگ‌تر برام قابل‌قبوله.' },

  { cat: 'C', text: 'نظم، برنامه‌ریزی دقیق و پیگیری جزئیات برام مهمه.' },
  { cat: 'C', text: 'کار با داده، اعداد یا فایل‌های منظم رو به آشفتگی ترجیح می‌دم.' },
  { cat: 'C', text: 'دنبال کردن یک دستورالعمل مشخص، ذهنم رو راحت می‌کنه.' },
];

const CAREER_SUGGESTIONS = {
  R: ['مهندسی و فنی', 'کشاورزی و دامپروری', 'الکترونیک و تعمیرات', 'ورزش حرفه‌ای'],
  I: ['پزشکی و پژوهش', 'برنامه‌نویسی و علوم داده', 'تحلیل‌گری', 'علوم آزمایشگاهی'],
  A: ['طراحی گرافیک و UI', 'نویسندگی و محتوا', 'موسیقی و بازیگری', 'معماری'],
  S: ['مشاوره و روان‌شناسی', 'آموزش و تدریس', 'منابع انسانی', 'مددکاری اجتماعی'],
  E: ['مدیریت و کارآفرینی', 'فروش و بازاریابی', 'وکالت', 'سیاست‌گذاری'],
  C: ['حسابداری و مالی', 'تحلیل داده', 'مدیریت پروژه', 'امور اداری و بایگانی'],
};

function topCategories(scores) {
  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([cat]) => cat);
}

// --- کیبوردها ---
function joinChannelKeyboard() {
  const channelUrl = `https://t.me/${CHANNEL_USERNAME.replace('@', '')}`;
  return {
    inline_keyboard: [
      [{ text: '📢 عضویت در کانال', url: channelUrl }],
      [{ text: '✅ عضو شدم، بررسی کن', callback_data: 'check_membership' }],
    ],
  };
}

function mainMenuKeyboard() {
  return {
    inline_keyboard: [[{ text: '💼 تست استعداد شغلی', callback_data: 'start_career_test' }]],
  };
}

function yesNoKeyboard(questionIndex) {
  return {
    inline_keyboard: [
      [
        { text: '✅ بله', callback_data: `answer_${questionIndex}_yes` },
        { text: '❌ خیر', callback_data: `answer_${questionIndex}_no` },
      ],
    ],
  };
}

function restartKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🔄 دوباره تست بده', callback_data: 'start_career_test' }],
      [{ text: '🏠 منوی اصلی', callback_data: 'main_menu' }],
    ],
  };
}

// --- چک عضویت کانال ---
const MEMBER_STATUSES = new Set(['creator', 'administrator', 'member']);

async function isChannelMember(userId) {
  try {
    const member = await bot.getChatMember(CHANNEL_USERNAME, userId);
    return MEMBER_STATUSES.has(member.status);
  } catch (err) {
    console.error('channel membership check failed:', err.message);
    return false;
  }
}

// --- هندلر /start ---
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  getUser(userId);

  const member = await isChannelMember(userId);
  if (!member) {
    await bot.sendMessage(
      chatId,
      `سلام! 👋 برای استفاده از این بات، اول باید عضو کانال ${CHANNEL_USERNAME} بشید.\n\nبعد از عضویت، روی دکمه «عضو شدم» بزنید.`,
      { reply_markup: joinChannelKeyboard() }
    );
    return;
  }

  await bot.sendMessage(chatId, 'خوش اومدی! 🎉 یکی از تست‌ها رو انتخاب کن:', {
    reply_markup: mainMenuKeyboard(),
  });
});

// --- هندلر دکمه‌ها ---
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const userId = query.from.id;
  const data = query.data;
  const user = getUser(userId);

  const ack = (text, alert = false) =>
    bot.answerCallbackQuery(query.id, { text, show_alert: alert });

  if (data === 'check_membership') {
    const member = await isChannelMember(userId);
    if (!member) {
      await ack('هنوز توی کانال عضو نشدی 🙁', true);
      return;
    }
    await ack('عضویت تایید شد ✅');
    await bot.editMessageText('خوش اومدی! 🎉 یکی از تست‌ها رو انتخاب کن:', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: mainMenuKeyboard(),
    });
    return;
  }

  const member = await isChannelMember(userId);
  if (!member) {
    await ack();
    await bot.editMessageText(
      `به نظر میاد از کانال ${CHANNEL_USERNAME} خارج شدی. برای ادامه دوباره عضو شو:`,
      { chat_id: chatId, message_id: messageId, reply_markup: joinChannelKeyboard() }
    );
    return;
  }

  if (data === 'main_menu') {
    await ack();
    await bot.editMessageText('یکی از تست‌ها رو انتخاب کن:', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: mainMenuKeyboard(),
    });
    return;
  }

  if (data === 'start_career_test') {
    await ack();
    user.currentQuestion = 0;
    user.scores = { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 };

    await bot.editMessageText(`سوال ۱ از ${QUESTIONS.length}:\n\n${QUESTIONS[0].text}`, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: yesNoKeyboard(0),
    });
    return;
  }

  if (data.startsWith('answer_')) {
    const [, idxStr, answer] = data.split('_');
    const idx = parseInt(idxStr, 10);

    if (idx !== user.currentQuestion) {
      await ack();
      return;
    }
    await ack();

    if (answer === 'yes') {
      const cat = QUESTIONS[idx].cat;
      user.scores[cat] = (user.scores[cat] || 0) + 1;
    }

    const nextIdx = idx + 1;

    if (nextIdx < QUESTIONS.length) {
      user.currentQuestion = nextIdx;
      await bot.editMessageText(
        `سوال ${nextIdx + 1} از ${QUESTIONS.length}:\n\n${QUESTIONS[nextIdx].text}`,
        { chat_id: chatId, message_id: messageId, reply_markup: yesNoKeyboard(nextIdx) }
      );
      return;
    }

    // تست تموم شد
    user.currentQuestion = -1;
    const top = topCategories(user.scores);
    const resultLines = top
      .map((cat) => `🔹 ${CATEGORY_NAMES[cat]}\n   ${CAREER_SUGGESTIONS[cat].join('، ')}`)
      .join('\n\n');

    await bot.editMessageText(
      `نتیجه تست استعداد شغلی تو:\n\n${resultLines}\n\nاین نتیجه بر اساس مدل هالند (RIASEC) و صرفاً برای آشنایی و راهنماییه، نه یک تشخیص قطعی. 🙂`,
      { chat_id: chatId, message_id: messageId, reply_markup: restartKeyboard() }
    );
    return;
  }

  await ack();
});

console.log('بات با موفقیت روشن شد ✅');
