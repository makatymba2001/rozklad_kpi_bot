let loading_start = new Date();
let loading_end;
require('dotenv').config();
require('./modules/overriders');
const {KEY_GETTERS, CB_SEPARATOR, createCallbackData, moment, now, MessageChain} = require('./modules/utils.js');
const pg = require('pg');
const client = new pg.Client({
    connectionString: process.env.DATABASE2_URL,
    ssl: {
        rejectUnauthorized: false
    }
})
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const { GroupManager } = require('./modules/group-data-manager');
const { ChatManager } = require('./modules/chat-data-manager');
const { formatScheduleData } = require('./modules/schedule-data-formatter');

const bot = new TelegramBot(process.env.TOKEN);
const gmanager = new GroupManager(client, bot);
const cmanager = new ChatManager(client, bot);

gmanager.loadWeekendsData(require('./json-data/weekends-data.json'));
gmanager.loadShuffleData(require('./json-data/shuffles-data.json'));
gmanager.loadTeachersData(require('./json-data/teachers-data.json'));

let buffer_commands_count = 0;
let total_commands_count = 0;
let last_check_count = 0;
let last_check_date = null;
let owner_id = +process.env.OWNER_ID;
let last_before_notif_date = null;
let last_now_notif_date = null;

function errorCatcher(error, messager){
    console.log(error.stack)
    if (!messager || !messager instanceof MessageChain) return;
    switch (error.message){
        case 'Group name not provided': return void messager.send('Група не була вказана.\nОбрати групу за замовчуванням: /bind');
        case 'Group not found': return void messager.send('Групу не було знайдено.');
        case 'Connection to http://rozklad.kpi.ua failed': return void messager.send('Не вдалося зв\'язатися з http://rozklad.kpi.ua');
        case 'Connection timeout to http://rozklad.kpi.ua': return void messager.send('http://rozklad.kpi.ua занадто довго відповідає');
        default: 
            bot.sendMessage(owner_id, `Виникла помилка!\n<pre>` + error.stack.replace(/\</g, '&lt;').replace(/\>/g, '&gt;').replace(/\&/g, '&amp;') + '</pre>', {parse_mode: 'HTML'})
            return void messager.send('Виникла помилка у роботі боту.');
    }
}
function addCommandCount(user_id){
    if ((user_id && user_id != owner_id) || !user_id) buffer_commands_count++;
}

function getNextNowNotifDate(lesson_number){
    if (lesson_number > 8) lesson_number = -1;
    let date = now().startOf('day');
    switch(lesson_number){
        case -1: date.add(1, 'day').seconds(30600); break;
        case 6: date.seconds(66600); break;
        case 7: date.seconds(73200); break;
        case 8: date.seconds(79200); break;
        default: date.seconds(30600 + (lesson_number - 1) * 6900); break;
    }
    return date;
}
function getNextBeforeNotifDate(lesson_number){
    return getNextNowNotifDate(lesson_number).add(-15, 'minutes')
}
async function startTimers(){
    let result = await client.query(`SELECT last_before_notif, last_now_notif, total_commands_count, last_check_date, last_check_count FROM overall_data`)
    let row = result.rows[0];
    last_before_notif_date = now(row.last_before_notif || 0);
    last_now_notif_date = now(row.last_now_notif || 0);
    total_commands_count = row.total_commands_count;
    last_check_date = new Date(row.last_check_date)
    last_check_count = row.last_check_count;
    setInterval(() => {
        if (buffer_commands_count === 0) return;
        client.query(`UPDATE overall_data SET total_commands_count = total_commands_count + $1`, [buffer_commands_count])
        .then(() => {
            total_commands_count += buffer_commands_count;
            buffer_commands_count = 0;
        }, errorCatcher)
    }, 60000)
    setInterval(async () => {
        let {now_date, lesson_number, day_weekend} = gmanager.getCurrentParams();
        if (day_weekend) return;
        if (now_date.isAfter(now(last_now_notif_date).add(3, 'minutes'))) {
            last_before_notif_date = getNextBeforeNotifDate(lesson_number + 1);
            last_now_notif_date = getNextNowNotifDate(lesson_number + 1);
            await client.query(`UPDATE overall_data SET (last_before_notif, last_now_notif) = ($1, $2)`, [last_before_notif_date.toDate(), last_now_notif_date.toDate()])
        }
        if (now_date.isBetween(last_before_notif_date, now(last_before_notif_date).add(3, 'minutes'))){
            let d = getNextBeforeNotifDate(lesson_number + 1);
            client.query(`UPDATE overall_data SET last_before_notif = $1`, [d.toDate()])
            .then(() => {
                last_before_notif_date = d;
                sendNotifications('before')
            }, errorCatcher)
        }
        else if (now_date.isBetween(last_now_notif_date, now(last_now_notif_date).add(3, 'minutes'))){
            let d = getNextNowNotifDate(lesson_number + 1);
            client.query(`UPDATE overall_data SET last_now_notif = $1`, [d.toDate()])
            .then(() => {
                last_now_notif_date = d;
                sendNotifications('now')
            }, errorCatcher)
        }
    }, 30000)
    return;
}
function sendNotifications(type){
    let process_array = Object.values(cmanager.chats_data).filter(chat_data => {
        return chat_data['chat_' + type + '_notifications'] && chat_data.chat_group_name
    })
    // Сначала надо протестить, а не разсылать всем подряд
    let x = setInterval(() => {
        let chat_data = process_array.shift();
        if (!chat_data) {
            clearInterval(x);
            // Мб что-то написать если нужно
            return;
        }
        let group_data = gmanager.get(chat_data.chat_group_name);
        let schedule_result = group_data.getCurrentLesson();
        if (!schedule_result.current_lesson) return;
        let {text, options} = formatScheduleData(type, schedule_result, group_data, chat_data);
        bot.sendMessage(chat_data.chat_id, text, options)
        .catch(e => {
            if (e.message.includes('ETELEGRAM: 403')) {
                chat_data.chat_group_name = null;
                chat_data.chat_before_notifications = false;
                chat_data.chat_now_notifications = false;
                chat_data.save().catch(() => {})
            }
        })
    }, 125)
}

//--------------------------------

let botMe = null;
client.connect().then(() => {
    Promise.all([
        bot.getMe(),
        gmanager.getDataFromDatabase(),
        cmanager.getDataFromDatabase(),
    ]).then(async ([user]) => {
        botMe = user;
        await startTimers();
        bot.startPolling({polling: true, onlyFirstMatch: true});
        loading_end = new Date();
        bot.sendMessage(owner_id, 'Я готовий до роботи!\n<b>' + now().format('DD.MM.YYYY HH:mm:ss') + '</b>', {parse_mode: 'HTML'})
        // updateAllSchedules();
        // importOldData();
    })
    .catch(e => {
        console.log(e.stack)
        process.exit();
    })
})

//--------------------------------

function isMyCommand(msg){
    if (!msg.text.startsWith('/')) return false;
    return msg.chat.type == 'private' || (new RegExp('^\/[^@]*@' + botMe.username)).test(msg.text)
}
let lesson_commands = [
    {
        command: 'current',
        description: 'Поточна пара'
    },
    {
        command: 'next',
        description: 'Наступна пара'
    },
    {
        command: 'today',
        description: 'Пари на сьогодні'
    },
    {
        command: 'tomorrow',
        description: 'Пари на завтра'
    },
    {
        command: 'nextday',
        description: 'Пари на наступний робочий день'
    },
    {
        command: 'week_current',
        description: 'Пари на поточний тиждень'
    },
    {
        command: 'week_next',
        description: 'Пари на наступний тиждень'
    },
]
let default_commands = [
    {
        command: 'start',
        description: 'Почати роботу з ботом'
    },
    {
        command: 'help',
        description: 'Повний список команд боту'
    },
    {
        command: 'feedback',
        description: 'Знайшли помилку або є що сказати?'
    }
]
let admin_commands = [
    {
        command: 'settings',
        description: 'Налаштування боту у цьому чаті'
    },
    {
        command: 'bind',
        description: 'Обрати групу у цьому чаті'
    },
]
let private_commands = [
    {
        command: 'keyboard',
        description: 'Відобразити клавіатуру'
    },
    {
        command: 'hide_keyboard',
        description: 'Сховати клавіатуру'
    },
]
let group_links_commands = [
    {
        command: 'links_delete',
        description: 'Видалити посилання на поточну пару'
    },
    {
        command: 'links_share',
        description: 'Поділитися посиланнями на пари у чаті'
    },
]
let private_links_commands = [
    {
        command: 'links_delete',
        description: 'Видалити посилання на поточну пару'
    },
]
// По какой-то неизвестной мне причине это не работает так, как задумано. Ну что ж, придётся по старинке
bot.setMyCommands(lesson_commands.concat(admin_commands).concat(private_commands).concat(group_links_commands).concat(default_commands), {
    scope: {
        type: 'default'
    }
})

//--------------------------------

Object.keys(KEY_GETTERS).forEach(k => {
    bot.onText(new RegExp('^\/' + k + '(?: |$|@)'), msg => {
        if (!isMyCommand(msg)) return;
        let chat_data = cmanager.get(msg.chat.id);
        addCommandCount(msg.from.id);
        let messager = new MessageChain(bot, msg.chat.id);
        gmanager.getGroupScheduleWithNotif(k, messager, {
            hide_teachers: chat_data.chat_hide_teachers,
            group_name: msg.text.substring(msg.entities[0].length).trim() || chat_data.chat_group_name || ''
        }).then(result => {
            if (result.is_list) return;
            let {text, options} = formatScheduleData(k, result.schedule_data, result.group_data, chat_data, chat_data.chat_hide_teachers);
            return messager.send(text, options)
        }).catch(e => errorCatcher(e, messager))
    })
})
bot.onText(/^\/bind(?:$|@)/, msg => {
    if (!isMyCommand(msg)) return;
    cmanager.get(msg.chat.id).isAdmin(msg.from.id)
    .then(b => {
        if (!b) return void bot.sendMessage(msg.chat.id, '⚠️ Для цього потрібно мати права адміністратора у цьому чаті.');
        return void  bot.sendMessage(msg.chat.id, 'Введіть назву групи, яку хочете обрати за замовчуванням.', {
            reply_to_message_id: msg.message_id,
            reply_markup: {
                force_reply: true,
                selective: true,
                input_field_placeholder: 'Назва групи'
            }
        });
    }).catch(e => errorCatcher(e, msg))
})
bot.onText(/^\/unbind(?:$|@)/, msg => {
    if (!isMyCommand(msg)) return;
    let chat_data = cmanager.get(msg.chat.id);
    chat_data.isAdmin(msg.from.id)
    .then(b => {
        if (!b) return void bot.sendMessage(msg.chat.id, '⚠️ Для цього потрібно мати права адміністратора у цьому чаті.');
        if (!chat_data.chat_group_name) return void bot.sendMessage(msg.chat.id, 'У цьому чаті вже немає обраної групи.');
        chat_data.unbind(msg.from.id, null, true)
        .then(() => {
            return void bot.sendMessage(msg.chat.id, 'Група успішно прибрана.');
        }, e => errorCatcher(e, msg))
    })
    .catch(e => errorCatcher(e, msg))
})
bot.onText(/^\/settings(?: |$|@)/, msg => {
    if (!isMyCommand(msg)) return;
    addCommandCount(msg.from.id);
    cmanager.get(msg.chat.id).sendSettings(msg.from.id)
    .catch(errorCatcher);
})

//--------------------------------

bot.onText(/^\/links_delete(?:$|@)/, msg => {
    if (!isMyCommand(msg)) return;
    let chat_data = cmanager.get(msg.chat.id);
    let current_lesson = gmanager.get(chat_data.chat_group_name).getCurrentLesson().current_lesson;
    if (!current_lesson) return; // Если нет пары - конец
    chat_data.sendLinksDelete(current_lesson.lesson_hash).catch(e => errorCatcher(e, msg))
})
bot.onText(/^\/links_share(?:$|@)/, msg => {
    if (msg.chat.id > 0) return void bot.sendMessage(msg.chat.id,
        'У цьому чаті є лише ти та я, тому з ким-небудь поділитись посиланнями на дистанційні пари не вийде.\nСпробуй використати цю команду у груповому чаті.'
    );
    bot.sendMessage(msg.chat.id, `Використайте кнопку нижче, щоб додати усі посилання на дистанційні пари з цього чату до приватного.`, {
        reply_markup: {
            inline_keyboard: [
                [{
                    text: 'Додати посилання',
                    callback_data: 'links_parent'
                }]
            ]
        }
    })
})
bot.onText(/meet\.google\.com\/|zoom\.[A-z]{2}\//, (msg, link_match) => {
    // Ответ на сообщение для добавления ссылки на пару
    let chat_data = cmanager.get(msg.chat.id);
    if (chat_data.chat_ignore_links) return; // Если это выключено - конец
    let current_lesson = gmanager.get(chat_data.chat_group_name)?.getCurrentLesson().current_lesson
    if (!current_lesson) return; // Если нет пары - конец
    let link_entity = msg.entities.find(entity => {
        return entity.type === 'url' && Math.onRange(entity.offset, link_match.index, entity.offset + entity.length);
    })
    if (!link_entity) return; // Если нет entity, что является ссылкой - конец
    let link_url = msg.text.substring(link_entity.offset, link_entity.offset + link_entity.length);
    let chat_links = chat_data.getLinks(current_lesson.lesson_hash);
    // Если ссылок больше 3 или такая ссылка уже есть - конец
    if (chat_links.length > 3 || chat_links.some(l => l.link_url === link_url)) return;
    let link_type;
    if (/meet\.google\.com\//.test(link_url)) link_type = "Meet"
    else if (/zoom\.[A-z]{2}\//.test(link_url)) link_type = "Zoom";
    else return; // Это не мит и не зум, мало ли такое случится, но на всякий
    let link_expire_date = now();
    if (link_expire_date.quarter() % 2) link_expire_date.add(1, 'quarter');
    let result_object = {
        link_lesson_hash: current_lesson.lesson_hash,
        link_title: link_type + ' (тимч.)',
        link_url,
        link_type,
        link_expire_date: link_expire_date.endOf('quarter')
    }
    let short_lesson_name = current_lesson.lesson_name;
    if (short_lesson_name.length > 48) short_lesson_name = short_lesson_name.substring(0, 45) + '...';
    
    chat_data.addTempLink(result_object).then(link_id => {
        let inline_keyboard = [[
            {
                text: 'Так',
                callback_data: createCallbackData('link_perm', {link_id, link_date: link_expire_date.toJSON(), message_id: msg.message_id})
            },
            {
                text: 'Тимчасово',
                callback_data: createCallbackData('link_temp', {link_id, link_date: link_expire_date.toJSON(), message_id: msg.message_id})
            },
            {
                text: 'Ні',
                callback_data: createCallbackData('link_cancel', {link_id, link_date: link_expire_date.toJSON(), message_id: msg.message_id})
            },
        ]];
        bot.sendMessage(msg.chat.id, '@' + msg.from.username + `, це посилання на дистанційну пару?\n<i>` + short_lesson_name + '</i>', {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard }
        }).catch(e => errorCatcher(e, msg))
    });
})

//--------------------------------

let start_text = `
<b>Привіт! Я бот, який хоче допомогти тобі та твоїй групі слідкувати за розкладом у КПІ в Telegram!</b>
Які пари зараз, сьогодні, завтра, цього або наступного тижня - одразу у Вашому чаті з урахуванням номеру неділі, переносів та свят, навіть коли http://rozklad.kpi.ua не працює!

- Додайте мене до чату своєї групи або використовуй особисті повідомлення
- Нашалтуйте бота командою /settings
- Готово! Використовуйте інші команди бота: /help

Якщо виникли проблеми з ботом, звертайтесь до @SleepyG11
`
bot.onText(/^\/start(?:$|@)/, msg => {
    bot.sendMessage(msg.chat.id, start_text, {parse_mode: 'HTML'})
})
bot.onText(/^\/start (-[0-9]{1,})$/, (msg, match) => {
    let chat_id = +match[1];
    let parent_chat_data = cmanager.get(chat_id)
    bot.getChatMember(chat_id, msg.from.id).then(async member => {
        if (['administator', 'creator', 'member'].includes(member.status)) {
            let chat_data = cmanager.get(msg.chat.id);
            await chat_data.bind(msg.from.id, parent_chat_data.chat_group_name);
            chat_data.setLinksParent(chat_id).then(() => {
                bot.sendMessage(msg.chat.id, 'Посилання з групового чату перенесені успішно.\nОзнайомитись з усіма можливостями боту: /help')
            }, errorCatcher)
        } else {
            bot.sendMessage(msg.chat.id, start_text, {parse_mode: 'HTML'})
        }
    }, e => {
        bot.sendMessage(msg.chat.id, start_text, {parse_mode: 'HTML'})
    })
})

let lesson_help_commands = [
    {
        command: 'current <i>[група]</i>',
        description: 'Поточна пара'
    },
    {
        command: 'next <i>[група]</i>',
        description: 'Наступна пара'
    },
    {
        command: 'today <i>[група]</i>',
        description: 'Пари на сьогодні'
    },
    {
        command: 'tomorrow <i>[група]</i>',
        description: 'Пари на завтра'
    },
    {
        command: 'nextday <i>[група]</i>',
        description: 'Пари на наступний робочий день'
    },
    {
        command: 'week_current <i>[група]</i>',
        description: 'Пари на поточний тиждень'
    },
    {
        command: 'week_next <i>[група]</i>',
        description: 'Пари на наступний тиждень'
    },
]
let commands_list = [
    default_commands,
    admin_commands,
    lesson_help_commands,
    private_commands,
    group_links_commands
]
bot.onText(/^\/help(?:$|@)/, msg => {
    if (!isMyCommand(msg)) return;
    let result_text = '<b>Усі команди боту:</b>\n\n' + commands_list.map(commands => {
        return commands.map(command => {
            return `/${command.command} - ${command.description}`
        }).join('\n')
    }).join('\n\n');
    bot.sendMessage(msg.chat.id, result_text, {parse_mode: 'HTML'})
})
bot.onText(/^\/feedback(?:$|@)/, msg => {
    bot.sendMessage(msg.chat.id, `
Якщо виникла помилка при роботі боту, або маєте ідею як його покращити, Ви можете звернутися до @SleepyG11 зі своїм проханням, зауваженням, побажанням, пропозицією, скаргою, ідеєю і так далі.

Якщо хочете віддячити автору копійкою на шавуху, номер картки:
Приват 4149 4390 0481 4616
    
<a href="https://github.com/makatymba2001/rozklad_kpi_bot">GitHub</a> | Hosted by <a href="https://www.heroku.com/home">Heroku</a>
Debug info: <tg-spoiler>ChatId: <b>${msg.chat.id}</b> | UserId: <b>${msg.from.id}</b></tg-spoiler>
`, {parse_mode: 'HTML', disable_web_page_preview: true})
})

bot.onText(/^\/keyboard(?:$|@)/, msg => {
    if (!isMyCommand(msg)) return;
    if (msg.chat.id < 0) return void bot.sendMessage(msg.chat.id, '@' + msg.from.username + ', щоб не заважати іншим, відобразити або сховати клавіатуру можна лише у приватному чаті.')
    bot.sendMessage(msg.chat.id, 'Клавіатура відображена. Сховати її: /hide_keyboard', {
        reply_markup: {
            resize_keyboard: true,
            keyboard: [
                [{text: "Яка зараз пара?"}, {text: 'Яка наступна пара?'}],
                [{text: "Які сьогодні пари?"}, {text: 'Які завтра пари?'}],
                [{text: "Який розклад цього тижня?"}, {text: 'Який розклад наступного тижня?'}],
            ]
        }
    });
})
bot.onText(/^\/hide_keyboard(?:$|@)/, msg => {
    if (!isMyCommand(msg)) return;
    if (msg.chat.id < 0) return void bot.sendMessage(msg.chat.id, '@' + msg.from.username + ', щоб не заважати іншим, відобразити або сховати клавіатуру можна лише у приватному чаті.')
    bot.sendMessage(msg.chat.id, 'Клавіатура схована.', {
        reply_markup: {
            remove_keyboard: true
        }
    });
})

//--------------------------------

bot.on('callback_query', query => {
    let splitted = query.data.split(CB_SEPARATOR);
    let command = splitted[0];
    let chat_data = cmanager.get(query.message.chat.id);
    let messager = new MessageChain(bot, query.message.chat.id, query.message.message_id)
    if (Object.keys(KEY_GETTERS).includes(command)){
        return void gmanager.getGroupScheduleWithNotif(command, messager, {
            group_name: splitted[1],
        }).then(result => {
            if (result.is_list) return;
            let {text, options} = formatScheduleData(command, result.schedule_data, result.group_data, cmanager.get(query.message.chat.id), splitted[2] === 'true');
            result.messager.send(text, options)
        }, e => errorCatcher(e, messager))      
    }
    switch (command){
        case 'close':
            bot.deleteMessage(query.message.chat.id, query.message.message_id).catch(errorCatcher)
            break;
        case 'bind':
            chat_data.isAdmin(query.from.id)
            .then(b => {
                if (!b) return bot.answerCallbackQuery(query.id, {
                    text: '⚠️ Для цього потрібно мати права адміністратора у цьому чаті.'
                })
                return gmanager.getGroupDataWithNotif(messager, {
                    group_name: splitted[1],
                    onGroupFound: group_data => {
                        chat_data.sendBind(query.from.id, group_data, query.message.message_id, query.id, true)
                        .catch(e => errorCatcher(e, messager))
                    }
                })
            }).catch(e => errorCatcher(e, messager))
            break;
        case 'settings':
            chat_data.sendSettings(query.from.id, query.message.message_id, query.id)
            .catch(e => errorCatcher(e, messager))
            break;
        case 'toggle':
            chat_data.toggle(query.from.id, splitted[1])
            .then(() => {
                chat_data.sendSettings(query.from.id, query.message.message_id, query.id, true)
                .catch(e => errorCatcher(e, messager));
            }, e => {
                if (e.message === 'Forbidden') return void bot.answerCallbackQuery(query.id, {
                    text: '⚠️ Для цього потрібно мати права адміністратора у цьому чаті.'
                })
                console.log(e.stack)
            })
            break;
        case 'link_temp':
            chat_data.applyTempLink(splitted[1], splitted[2])
            .then(() => {
                return messager.send('Посилання додано.')
            }).catch(e => errorCatcher(e, messager));
            break;
        case 'link_perm':
            bot.sendMessage(query.message.chat.id, 'Додайте назву посиланню.', {
                reply_to_message_id: splitted[3],
                reply_markup: {
                    force_reply: true,
                    selective: true,
                    input_field_placeholder: 'Назва групи. Не більше 24 символів.'
                }
            }).then(m => {
                let listener = bot.onReplyToMessage(m.chat.id, m.message_id, msg => {
                    let link_title = msg.text.replace(/\|/g, '');
                    if (link_title.length > 24) return void bot.sendMessage(msg.chat.id, "Назва занадто довга!");
                    bot.removeReplyListener(listener);
                    console.log(splitted[1], splitted[2], link_title)
                    Promise.allSettled([
                        cmanager.get(msg.chat.id).applyPermLink(splitted[1], splitted[2], link_title),
                        bot.deleteMessage(msg.chat.id, query.message.message_id),
                    ])
                    .then(() => {
                        return bot.sendMessage(msg.chat.id, "Посилання додано.", {
                            reply_markup: {
                                remove_keyboard: true
                            }
                        })
                    })
                    .catch(e => errorCatcher(e, msg))
                })
                bot.editMessageText('Щоб відмінити дію, натисніть кнопку нижче.', {
                    chat_id: query.message.chat.id,
                    message_id: query.message.message_id,
                    reply_markup: {
                        inline_keyboard: [[
                            {
                                text: 'Відмінити',
                                callback_data: createCallbackData('link_cancel_perm', {
                                    link_id: splitted[1],
                                    message_id: m.message_id,
                                })
                            }
                        ]]
                    }
                })
            })
            break;
        case 'link_cancel':
            chat_data.removeTempLink(splitted[1])
            .then(() => {
                bot.deleteMessage(query.message.chat.id, query.message.message_id)
            }).catch(e => errorCatcher(e, msg));
            break;
        case 'link_cancel_perm':
            Promise.allSettled([
                chat_data.removeTempLink(splitted[1]),
                bot.deleteMessage(query.message.chat.id, query.message.message_id),
                bot.deleteMessage(query.message.chat.id, splitted[2]),
            ]).catch(e => errorCatcher(e, msg))
            break;
        case 'link_delete':
            chat_data.deleteLink(splitted[1], splitted[2], query.message.message_id)
            .catch(e => errorCatcher(e, msg))
            break;
        case 'links_parent':
            bot.sendMessage(query.from.id, 'Посилання з групового чату перенесені успішно.')
            .then(m => {
                cmanager.get(query.from.id).setLinksParent(query.message.chat.id)
            }, e => {
                if (e.message.includes('ETELEGRAM: 403')) return void bot.answerCallbackQuery(query.id, {
                    text: '⚠️ Ви не працювали зі мною.',
                    url: 't.me/RozkladKpiTest_bot?start=' + query.message.chat.id
                })
                console.log(e.stack)
            })
            break;
        case 'links_parent_delete':
            chat_data.isAdmin(query.from.id)
            .then(b => {
                if (!b) {
                    bot.answerCallbackQuery(query.id, {
                        text: '⚠️ Для цього потрібно мати права адміністратора у цьому чаті.'
                    })
                    return null;
                } else return chat_data.setLinksParent(null)
            })
            .then(r => {
                if (r === null) return;
                return chat_data.sendSettings(query.from.id, query.message.message_id, query.id, true)
            })
            .catch(e => errorCatcher(e, msg))
            break;
    }
})
bot.on('message', msg => {
    if (msg.reply_to_message && msg.reply_to_message.text === 'Введіть назву групи, яку хочете обрати за замовчуванням.'){
        // Ответ на сообщение для добавления группы
        let chat_data = cmanager.get(msg.chat.id);
        let group_name_to_bind = msg.text.trim().toLowerCase();
        let messager = new MessageChain(bot, msg.chat.id);
        chat_data.isAdmin(msg.from.id)
        .then(b => {
            if (!b) return;
            if (group_name_to_bind.toLowerCase() === chat_data?.chat_group_name?.toLowerCase()) {
                return void bot.sendMessage(msg.chat.id, 'Ця група вже прив\'язана. Спробуйте іншу.')
            }
            return bot.sendMessage(msg.chat.id, 'Починаю пошук групи...', {
                reply_markup: {
                    remove_keyboard: true,
                }
            })
        })
        .then(mm => {
            if (!mm) return;
            return gmanager.getGroupDataWithNotif(messager, {
                group_name: group_name_to_bind,
                onListFound: group_data => {
                    let inline_keyboard = [];
                    group_data.getList().forEach((g, i) => {
                        if (i === 0) return;
                        inline_keyboard.push([{
                            text: g.group_name,
                            callback_data: createCallbackData('bind', {
                                group_data: g,
                                chat_data
                            })
                        }])
                    })
                    messager.send('Знайдено декілька варіантів.\nОберіть потрібний.', {
                        reply_markup: {
                            inline_keyboard,
                        }
                    }).catch(e => errorCatcher(e, messager))
                },
                onGroupFound: group_data => {
                    chat_data.bind(msg.from.id, group_data, true)
                    .then(() => {
                        return messager.send('Група успішно змінена на ' + group_data.group_name + '.')
                    })
                    .catch(e => errorCatcher(e, messager))
                }
            })
        })
        .catch(e => errorCatcher(e))
    }
})

//--------------------------------

bot.onText(/^\/admin(?: |$|@)/, msg => {
    if (msg.from.id != owner_id) return;
    if (!isMyCommand(msg)) return;
    total_commands_count += buffer_commands_count;
    buffer_commands_count = 0;
    bot.sendMessage(msg.chat.id, `
<b>Last restart date:</b> ${now(loading_start).format('DD.MM HH:mm:ss')}
<b>Init time:</b> ${(loading_end - loading_start)} ms.
<b>Commands used:</b> ${total_commands_count} <i>(+${total_commands_count - last_check_count} since ${now(last_check_date).format('DD.MM HH:mm:ss')})</i>

<b>Groups count:</b> ${Object.keys(gmanager.groups_storage).length}
<b>Lists count:</b> ${Object.keys(gmanager.lists_storage).length}
<b>Chats count:</b> ${Object.keys(cmanager.chats_data).length} <i>(${Object.keys(cmanager.chats_data).filter(id => id < 0).length} groups)</i>`,
{parse_mode: 'HTML'})
    last_check_count = total_commands_count;
    last_check_date = new Date();
    client.query('UPDATE overall_data SET (total_commands_count, last_check_date, last_check_count) = ($1, $2, $3)', [total_commands_count, last_check_date, last_check_count])
    .catch(e => errorCatcher(e, msg))
})
bot.onText(/^\/adminstat(?: |$|@)/, msg => {
    if (msg.from.id != owner_id) return;
    if (!isMyCommand(msg)) return;
    let chats_list = Object.values(cmanager.chats_data).map(chat_data => chat_data.chat_group_name?.trim());
    let chats_with_groups = chats_list.filter(g => g);
    let groups_counter = {};
    chats_with_groups.forEach(group => {
        groups_counter[group] = (groups_counter[group] || 0) + 1;
    });
    let reverted_data = [];
    Object.entries(groups_counter).forEach(([group, count]) => {
        if (!reverted_data[+count]) reverted_data[+count] = [];
        reverted_data[+count].push(group);
    })
    let result_string = reverted_data.map((group, count) => {
        if (!group) return count + ': null'
        return count + ': ' +  group.sort().join(' | ')
    }).join('\n------------------\n')
    fs.writeFileSync('groups-stat.txt', result_string, {encoding: 'utf-8'});
    bot.sendDocument(-522962876, './groups-stat.txt', {}, {
        contentType: 'plain/text',
        filename: 'group-stat.txt'
    })
})

bot.onText(/\/eval (.+)/, async (msg, match) => {
    if (msg.from.id != owner_id) return;
    console.log('[EVAL]', match[1])
    let result;
    try{
        setTimeout(() => {
            throw new Error('eval timeout')
        }, 10000)
        result = await eval(match[1]);
    }
    catch(e){
        result = e instanceof Error ? e.toString() : e;
    }
    if (!(result instanceof Object) || typeof result === 'function') result = String(result)
    else {
        try{
            result = Array.isArray(result) ? ('[' + result.toString() + ']') : JSON.stringify(result, null, ' ');
        }
        catch(e){
            result = result.toString() + ' (with circular)';
        }
    }
    console.log(e)
    if (result.length > 2043) result = result.substring(0, 2040) + '...'
    result = result.replace(/\</g, '&lt;').replace(/\>/g, '&gt;').replace(/\&/g, '&amp;')
    bot.sendMessage(owner_id, '[EVAL]\n<pre><code class="language-js">' + result.replace() + '</code></pre>', {disable_web_page_preview: true, parse_mode: 'HTML'})
})

//--------------------------------

let regexp_patterns = {
    current: [
        ["Какая", "Яка", "Чи є", "Есть ли", "Есть", "Є", "Что за", "Шо за", "Що за"],
        ["Сейчас", "Зараз", "Щас", "Ща"],
        ["Пара", "Пары", "Пари", "Лекция", "Лекции", "Лекція", "Лекції", "Практика", "Практики", "Лаба", "Лабы", "Лаби"]
    ],
    next: [
        ["Какая", "Яка", "Когда", "Коли", "Что за", "Шо за", "Що за"],
        ["Следующая", "Наступна", "След", "Некст"],
        ["Пара", "Лекция", "Лекція", "Практика", "Лаба"]
    ],
    today: [
        ["Какие", "Які", "Чи є", "Есть ли", "Есть", "Є", "Что за", "Шо за", "Що за"],
        ["Сегодня", "Сьогодні", "Сьодні", "Сёдня", "Седня"],
        ["Пары", "Пари", "Лекции", "Лекції", "Практики", "Лабы", "Лаби"]
    ],
    tomorrow: [
        ["Какие", "Які", "Чи є", "Есть ли", "Есть", "Є", "Что за", "Шо за", "Що за"],
        ["Завтра"],
        ["Пары", "Пари", "Лекции", "Лекції", "Практики", "Лабы", "Лаби"]
    ],
    "nextday-1": [
        ["Какие", "Які", "Когда", "Коли"],
        ["Следующие", "Наступні", "След", "Некст", "Ближайшие", "Найближчі", "Скоро"],
        ["Пары", "Пари", "Лекции", "Лекції", "Практики", "Лабы", "Лаби"]
    ],
    "nextday-2": [
        ["Какой", "Какая", "Який", "Яка", "Когда", "Коли", "Что за", "Шо за", "Що за"],
        ["Следующий", "Следующая", "Наступний", "Наступна", "След", "Некст"],
        ["Рабочий", "Робочий", "Рабочая", "Учебный", "Учбовий", "Учбова"],
        ["День", "Неделя", "Тиждень", "Неділя"]
    ],
    week_current: [
        ["Какие", "Какое", "Які", "Який", "Что за", "Шо за", "Що за"],
        ["Пары", "Пари", "Расписание", "Розклад", "Пари", "Лекции", "Лекції", "Практики", "Лабы", "Лаби"],
        ["На этой", "На цій", "На цьому", "Цього", "Этой"],
        ["Неделе", "Недели", "Тижня", "Тиждня", "Тижні", "Тиждні", "Неділі"]
    ],
    week_next: [
        ["Какие", "Какое", "Які", "Який", "Что за", "Шо за", "Що за"],
        ["Пары", "Пари", "Расписание", "Розклад", "Пари", "Лекции", "Лекції", "Практики", "Лабы", "Лаби"],
        ["На следующей", "На след", "След", "На некст", "Некст", "На наступній", "Следующего", "Следующей", "Наступного", "Наступної"],
        ["Неделе", "Недели", "Тижня", "Тиждня", "Неділі"]
    ],
    week_first: [
        ["Какие", "Какое", "Які", "Який", "Что за", "Шо за", "Що за"],
        ["Пары", "Пари", "Расписание", "Розклад", "Пари", "Лекции", "Лекції", "Практики", "Лабы", "Лаби"],
        ["На первой", "Первой", "На першій", "Першій", "На першому", "Першому", "Першого", "1"],
        ["Неделе", "Недели", "Тижня", "Тиждня", "Тижні", "Неділі"]
    ],
    week_second: [
        ["Какие", "Какое", "Які", "Який", "Что за", "Шо за", "Що за"],
        ["Пары", "Пари", "Расписание", "Розклад", "Пари", "Лекции", "Лекції", "Практики", "Лабы", "Лаби"],
        ["На второй", "Второй", "На другій", "Другій", "На друому", "Другому", "Другого", "2"],
        ["Неделе", "Недели", "Тижня", "Тиждня", "Тижні", "Неділі"]
    ],
}
function processRegExpPattern(pattern){
    let max_index = pattern.length;
    pattern = '(' + pattern.map(p => {
        return '(' + p.join('|') + ')';
    }).join('|') + ')';
    let group_iterator = 1;
    let result_string = pattern;
    while (group_iterator <= max_index - 1){
        let copier = '', sub_iterator = 1;
        while (sub_iterator <= group_iterator){
            copier += '\\' + sub_iterator++;
        }
        copier = '(?!' + copier + ')'
        result_string += ' ' + copier + pattern;
        group_iterator++
    }
    return new RegExp(result_string + '\\?', 'gi')
}
Object.entries(regexp_patterns).forEach(([k, pattern]) => {
    k = k.split('-')[0];
    bot.onText(processRegExpPattern(pattern), msg => {
        let chat_data = cmanager.get(msg.chat.id);
        if (!chat_data.chat_group_name) return;
        addCommandCount(msg.from.id);
        let messager = new MessageChain(bot, msg.chat.id);
        gmanager.getGroupSchedule(k, chat_data.chat_group_name)
        .then(result => {
            if (result.is_list) return;
            let {text, options} = formatScheduleData(k, result.schedule_data, result.group_data, chat_data, chat_data.chat_hide_teachers);
            return messager.send(text, Object.assign(options, {reply_to_message_id: msg.message_id}))
        })
        .catch(e => errorCatcher(e))
    })
})

//--------------------------------

bot.on('error', e => {
    console.log(e.stack)
})
bot.on('polling_error', e => {
    console.log(e.stack)
})
async function reconnectToDatabase(){
    await bot.stopPolling({cancel: true});
    await client.connect();
    await bot.startPolling({polling: true, onlyFirstMatch: true});
}
client.on('error', error => {
    console.log(error.stack);
    reconnectToDatabase().catch(reconnectToDatabase)
})

//--------------------------------

function importOldData(){
    let data = require('./json-data/channels-dump.json');
    let links_data = require('./json-data/links-dump.json');
    Object.values(data).forEach(d => {
        let chat_data = cmanager.get(d.id);
        let links = links_data[d.id] || {};
        chat_data.chat_ignore_links = d.links_ignore || false;
        chat_data.chat_group_name = d.group || null;
        chat_data.chat_hide_teachers = !d.teachers;
        chat_data.chat_before_notifications = d.notifications || false;
        chat_data.chat_links_parent_id = links.parent || null;
        delete links.parent;
        let full_links_data = {};
        Object.keys(links).forEach(key => {
            full_links_data[key] = links[key].filter(link => !link.temp).map(link => {
                let link_type;
                if (/meet\.google\.com\//.test(link.link)) link_type = "Meet"
                else if (/zoom\.[A-z]{2}\//.test(link.link)) link_type = "Zoom";
                return {
                    link_lesson_hash: key,
                    link_title: link.name,
                    link_type,
                    link_url: link.link,
                    link_expire_date: now().endOf('quarter')
                }
            })
        })
        full_links_data.temp = [];
        chat_data.chat_links_data = full_links_data;
        chat_data.save().then(() => {
            console.log('Сохранено', d.id)
        });
    })
}
function updateAllSchedules(){
    let groups_list = Object.values(cmanager.chats_data).map(chat_data => chat_data.chat_group_name?.trim()).filter(g => g);
    let groups_maybe_lists = groups_list.filter(group_name => group_name.split(' ').length > 1);
    let groups_no_list_lists = groups_list.filter(group_name => group_name.split(' ').length === 1);
    let set = new Set(groups_no_list_lists);
    let array_to_process = Array.from(set.values());
    let executer = () => {
        let group_name = array_to_process.shift();
        if (!group_name) return void console.log('FINE')
        gmanager.get(group_name).search().then(g => {
            console.log("Обновлен", g.group_name)
            executer();
        }, e => {
            console.log(e.stack);
            executer();
        });
    }
    executer();
}