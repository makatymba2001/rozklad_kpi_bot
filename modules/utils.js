const moment = require('moment-timezone');
const TelegramBot = require('node-telegram-bot-api')
function now(date){
    return moment.tz(date, 'Europe/Kiev')
}
function now_unix(date){
    return moment.unix(date).tz('Europe/Kiev')
}
function dateDefinition(date){
    let int = date - now()
    if (int < 0) return 'Помилка!'
    if (int < 60000) return 'Ось-ось почнеться'
    if (int < 3600000){
        let m = Math.round(int / 60000);
        if (String(m).match(/1[0-9]$/)) return 'Через ' + m + ' хвилин';
        switch(m % 10){
            case 1: return 'Через ' + m + ' хвилину';
            case 2: case 3: case 4: return 'Через ' + m + ' хвилини';
            default: return 'Через ' + m + ' хвилин';
        }
    }
    if (int < 86400000 * 1.5){
        let h = Math.floor(int / 3600000);
        let m = Math.floor((int - h*3600000)/60000);
        if (m === 0) m = '';
        else if (String(m).match(/1[0-9]$/)) m += ' хвилин';
        else{
            switch(m % 10){
                case 1: m += ' хвилину'; break;
                case 2: case 3: case 4: m += ' хвилини'; break;
                default: m += ' хвилин'; break;
            }
        }
        if (String(h).match(/1[0-9]$/)) h += ' годин';
        else{
            switch(h % 10){
                case 1: h += ' годину'; break;
                case 2: case 3: case 4: h += ' години'; break;
                default: h += ' годин'; break;
            }
        }
        return 'Через ' + h + ' ' + m;
    }
    else{
        let days = Math.round(int / 86400000);
        if (String(days).match(/1[0-9]$/)) return 'Через ' + days + ' днів';
        switch(days % 10){
            case 1: return 'Через ' + days + ' день'
            case 2: case 3: case 4: return 'Через ' + days + ' дні';
            default: return 'Через ' + days + ' днів';
        }
    }
}
class MessageChain{
    constructor(bot, chat_id, message_id){
        /**
         * @type {TelegramBot}
         */
        this.bot = bot;
        this.chat_id = chat_id;
        this.message_id = message_id || null;
    }
    /**
     * @param {String} text 
     * @param {TelegramBot.SendMessageOptions} options 
     * @returns {Promise<TelegramBot.Message>}
     */
    send(text, options){
        return new Promise((resolve, reject) => {
            if (this.message_id){
                this.bot.editMessageText(text, Object.assign(options || {}, {
                    chat_id: this.chat_id, message_id: this.message_id
                })).then(msg => {
                    this.message_id = msg.message_id;
                    resolve(msg)
                }, reject)
            } else {
                this.bot.sendMessage(this.chat_id, text, options || {}).then(msg => {
                    this.message_id = msg.message_id;
                    resolve(msg)
                }, reject)
            }
        })
    }
}

const CB_SEPARATOR = '|'
const KEY_GETTERS = {
    current: "getCurrentLesson",
    next: "getNextLesson",
    today: "getTodayLessons",
    tomorrow: "getTomorrowLessons",
    nextday: "getNextDayLessons",
    week_current: "getCurrentWeekLessons",
    week_next: "getNextWeekLessons",
    week_first: "getFirstWeekLessons",
    week_second: "getSecondWeekLessons",
}
const DAY_NAMES = {
    1: 'Понеділок',
    2: "Вівторок",
    3: "Середа",
    4: "Четвер",
    5: "П'ятниця",
    6: "Субота",
    7: "Неділя"
}
const CHAT_TOGGLERS = {
    hide_teachers: "Відображати вчителів",
    ignore_links: "Помічати посилання на дистанційні пари",
    before_notifications: "Повідомлення перед початком пари",
    now_notifications: "Повідомлення про початок пари"
}
const LESSON_TIMES = {
    0: null,
    1: '08:30 - 10:05',
    2: '10:25 - 12:00',
    3: '12:20 - 13:55',
    4: '14:15 - 15:50',
    5: '16:10 - 17:45',
    6: '18:30 - 20:05',
    7: '20:20 - 21:55',
    8: null
}

/**
 * @param {String} command 
 * @param {import('./group-data-manager').Group} group_data 
 * @param {import('./chat-data-manager').Chat} chat_data 
 * @returns {String}
 */
function createCallbackData(command, options = {}){
    if (Object.keys(KEY_GETTERS).concat(['bind']).includes(command)) return [command, options.group_data.group_name, options.hide_teachers ?? (options.chat_data?.chat_hide_teachers || false)].join(CB_SEPARATOR)
    if (Object.keys(CHAT_TOGGLERS).includes(command)) return ['toggle', command].join(CB_SEPARATOR)
    if (['link_temp', 'link_perm', 'link_cancel'].includes(command)) return [command, options.link_id, options.link_date, options.message_id].join(CB_SEPARATOR)
    if (command === 'link_delete') return [command, options.lesson_hash, options.link_index].join(CB_SEPARATOR)
    if (command === 'link_cancel_perm') return [command, options.link_id, options.message_id].join(CB_SEPARATOR)
    throw new Error('Invalid callback data command')
}



module.exports = {
    MessageChain, moment, now, now_unix, dateDefinition, createCallbackData, CB_SEPARATOR, KEY_GETTERS, DAY_NAMES, LESSON_TIMES, CHAT_TOGGLERS
}
