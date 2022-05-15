const TelegramBot = require('node-telegram-bot-api')
const { createCallbackData, dateDefinition, DAY_NAMES, LESSON_TIMES } = require('./utils')

/**
 * @param {import("./group-data-manager").ScheduleLesson} lesson 
 * @param {import("./group-data-manager").DateParams} params
 * @param {import("./chat-data-manager").ChatLinkData[]} links 
 */
function formatSingleLesson(params, lesson, links){
    let t = `<b>${lesson.lesson_name}</b>\n`
    t += `<i>${params.lesson_number} пара /${lesson.lesson_type ? ` ${lesson.lesson_type} /` : ''} ${LESSON_TIMES[params.lesson_number]}</i>\n\n`
    t += `${lesson.lesson_rooms.length > 1 ? 'Кабінети:' : "Кабінет:"} <i>${!lesson.lesson_rooms.length ? 'Невідомо'
    : lesson.lesson_rooms.map(r => r.room_name).join(', ')}</i>\n`
    t += (lesson.lesson_teachers.length > 1 ? 'Викладачі:' : "Викладач:") + (!lesson.lesson_teachers.length ? ' <i>Невідомо</i>'
    : ('\n' + lesson.lesson_teachers.map(t => '≻ <i>' + t.teacher_name + '</i>').join('\n')));
    if (links.length) t += '\nПосилання: ' + links.map(link => {
        return `<a href="${link.link_url}">${link.link_title}</a>`
    }).join(' ')
    return t;
}
/**
 * @param {import("./group-data-manager").ScheduleDay} lessons 
 * @param {import("./group-data-manager").DateParams} params 
 */
function formatDayLessons(params, lessons, hide_teachers){
    let t = '';
    for (let i = 1; i <= Math.max(lessons.max, 5); i++){
        let s = `<b>[${i}] [${LESSON_TIMES[i]}]</b> `
        let lesson = lessons[i];
        if (!lesson && i < 6) {
            s += `<i>Нічого</i>`;
        } else if (lesson){
            if (lesson.lesson_rooms.length){
                s += `<u>${lesson.lesson_rooms.map(room => room.room_name).join(', ')}</u>`
                if (lesson.lesson_type) s += ' · '
            }
            s += (lesson.lesson_type || '') + ' - ' + lesson.lesson_name
            if (!hide_teachers && lesson.lesson_teachers.length) {
                s += '\n' + lesson.lesson_teachers.map(teacher => ' ≻  <i>' + teacher.teacher_name + '</i>').join('\n')
            }
        }
        t += s + '\n'
    }
    return t;
}
/**
 * @param {import("./group-data-manager").ScheduleWeek} days 
 * @param {import("./group-data-manager").DateParams} params 
 */
function formatWeekLessons(params, days, hide_teachers){
    let t = '';
    days.forEach((day, index) => {
        index++;
        let u = `<b>${DAY_NAMES[index]}</b>\n`;
        if (!day.count && index < 6){
            u += `<i>Пар немає.</i>`
            t += u + '\n\n'
        } else if (day.count){
            day.forEach((lesson, i) => {
                let s = `<b>[${i}]</b> `
                if (lesson.lesson_rooms.length){
                    s += `<u>${lesson.lesson_rooms.map(room => room.room_name).join(', ')}</u>`
                    if (lesson.lesson_type) s += ' · '
                }
                s += (lesson.lesson_type || '') + ' - ' + lesson.lesson_name
                if (!hide_teachers && lesson.lesson_teachers.length) {
                    s += '\n' + lesson.lesson_teachers.map(teacher => ' ≻  <i>' + teacher.teacher_name + '</i>').join('\n')
                }
                u += s + '\n'
            })
            t += u + '\n'
        }
    })
    return t;
}

/**
 * @param {import("./group-data-manager").CurrentScheduleResult} schedule_data 
 * @param {import("./group-data-manager").Group} group_data
 * @param {import("./chat-data-manager").Chat} chat_data
 * @returns {{text: string, options: TelegramBot.SendMessageOptions}}
 */
function formatCurrentLesson(schedule_data, group_data, chat_data){
    let {current_params, current_lesson} = schedule_data;
    let keyboard = {
        inline_keyboard: [[
            {
                text: 'Наступна пара',
                callback_data: createCallbackData('next', {group_data, chat_data})
            }
        ]]
    }
    if (current_params.day_weekend) return {
        text: `Сьогодні, тобто ${current_params.query_date.format('DD.MM')}, ${current_params.day_weekend}`,
        options: {
            parse_mode: 'HTML',
            reply_markup: keyboard
        }
    }
    if (!current_lesson) return {
        text: `Зараз у групи ${group_data.group_name} пари немає.`,
        options: {
            parse_mode: 'HTML',
            reply_markup: keyboard
        }
    }
    if (current_params.lesson_is_brake) return {
        text: `<b>Наступна пара у групи ${group_data.group_name} (${dateDefinition(current_params.lesson_date).toLowerCase()}):</b>\n\n`
        + formatSingleLesson(current_params, current_lesson, chat_data.getLinks(current_lesson.lesson_hash, true, true)),
        options: {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
        }
    }
    return {
        text: `<b>Поточна пара у групи ${group_data.group_name}:</b>\n\n`
        + formatSingleLesson(current_params, current_lesson, chat_data.getLinks(current_lesson.lesson_hash, true, true)),
        options: {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
        }
    }
}
/**
 * @param {import("./group-data-manager").CurrentScheduleResult} schedule_data 
 * @param {import("./group-data-manager").Group} group_data
 * @param {import("./chat-data-manager").Chat} chat_data
 * @returns {{text: string, options: TelegramBot.SendMessageOptions}}
 */
function formatBeforeLesson(schedule_data, group_data, chat_data){
    let {current_params, current_lesson} = schedule_data;
    return {
        text: `<b>Через 15 хвилин у групи ${group_data.group_name}:</b>\n\n`
        + formatSingleLesson(current_params, current_lesson, chat_data.getLinks(current_lesson.lesson_hash, true, true)),
        options: {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
        }
    }
}
/**
 * @param {import("./group-data-manager").CurrentScheduleResult} schedule_data 
 * @param {import("./group-data-manager").Group} group_data
 * @param {import("./chat-data-manager").Chat} chat_data
 * @returns {{text: string, options: TelegramBot.SendMessageOptions}}
 */
 function formatNowLesson(schedule_data, group_data, chat_data){
    let {current_params, current_lesson} = schedule_data;
    return {
        text: `<b>Зараз у групи ${group_data.group_name}:</b>\n\n`
        + formatSingleLesson(current_params, current_lesson, chat_data.getLinks(current_lesson.lesson_hash, true, true)),
        options: {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
        }
    }
}
/**
 * @param {import("./group-data-manager").NextScheduleResult} schedule_data 
 * @param {import("./group-data-manager").Group} group_data
 * @param {import("./chat-data-manager").Chat} chat_data
 * @returns {{text: string, options: TelegramBot.SendMessageOptions}}
 */
function formatNextLesson(schedule_data, group_data, chat_data){
    let {next_params, next_lesson} = schedule_data;
    if (!next_params.is_valid || !next_lesson) return {
        text: `Наступну пару у групи ${group_data.group_name} не було знайдено.`,
        options: {
            parse_mode: 'HTML',
        }
    }
    return {
        text: `<b>Наступна пара у групи ${group_data.group_name} (${dateDefinition(next_params.lesson_date).toLowerCase()}):</b>\n\n`
        + formatSingleLesson(next_params, next_lesson, chat_data.getLinks(next_lesson.lesson_hash, true, true)),
        options: {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
        }
    }
}

/**
 * @param {import("./group-data-manager").TodayScheduleResult} schedule_data 
 * @param {import("./group-data-manager").Group} group_data
 * @param {import('./chat-data-manager').Chat} chat_data 
 * @returns {{text: string, options: TelegramBot.SendMessageOptions}}
 */
function formatTodayLessons(schedule_data, group_data, chat_data){
    let {current_params, today_lessons} = schedule_data;
    let keyboard = {
        inline_keyboard: [[
            {
                text: 'Наступний робочий день',
                callback_data: createCallbackData('nextday', {group_data, chat_data})
            }
        ]]
    }
    if (current_params.day_weekend) return {
        text: `Сьогодні, тобто ${current_params.query_date.format('DD.MM')}, ${current_params.day_weekend}`,
        options: {
            parse_mode: 'HTML',
            reply_markup: keyboard
        }
    }
    if (!today_lessons.length) return {
        text: `Сьогодні, тобто ${current_params.query_date.format('DD.MM')}, у групи ${group_data.group_name} пар немає.`,
        options: {
            parse_mode: 'HTML',
            reply_markup: keyboard
        }
    }
    return {
        text: `<b>Пари на ${current_params.query_date.format('DD.MM')} (${DAY_NAMES[current_params.day_weekday].toLowerCase()}) у групи ${group_data.group_name}:</b>\n\n`
        + formatDayLessons(current_params, today_lessons, chat_data.chat_hide_teachers),
        options: {
            parse_mode: 'HTML'
        }
    }
}
/**
 * @param {import("./group-data-manager").TomorrowScheduleResult} schedule_data 
 * @param {import("./group-data-manager").Group} group_data
 * @param {import('./chat-data-manager').Chat} chat_data 
 * @returns {{text: string, options: TelegramBot.SendMessageOptions}}
 */
function formatTomorrowLessons(schedule_data, group_data, chat_data){
    let {tomorrow_params, tomorrow_lessons} = schedule_data;
    let keyboard = {
        inline_keyboard: [[
            {
                text: 'Наступний робочий день',
                callback_data: createCallbackData('nextday', {group_data, chat_data})
            }
        ]]
    }
    if (tomorrow_params.day_weekend) return {
        text: `Завтра, тобто ${tomorrow_params.query_date.format('DD.MM')}, ${tomorrow_params.day_weekend}`,
        options: {
            parse_mode: 'HTML',
            reply_markup: keyboard
        }
    }
    if (!tomorrow_lessons.length) return {
        text: `Завтра, тобто ${tomorrow_params.query_date.format('DD.MM')}, у групи ${group_data.group_name} пар немає.`,
        options: {
            parse_mode: 'HTML',
            reply_markup: keyboard
        }
    }
    return {
        text: `<b>Пари на ${tomorrow_params.query_date.format('DD.MM')} (${DAY_NAMES[tomorrow_params.day_weekday].toLowerCase()}) у групи ${group_data.group_name}:</b>\n\n`
        + formatDayLessons(tomorrow_params, tomorrow_lessons, chat_data.chat_hide_teachers),
        options: {
            parse_mode: 'HTML'
        }
    }
}
/**
 * @param {import("./group-data-manager").NextdayScheduleResult} schedule_data 
 * @param {import("./group-data-manager").Group} group_data
 * @param {import('./chat-data-manager').Chat} chat_data 
 * @returns {{text: string, options: TelegramBot.SendMessageOptions}}
 */
function formatNextDayLessons(schedule_data, group_data, chat_data){
    let {nextday_params, nextday_lessons} = schedule_data;
    if (!nextday_params.is_valid || !nextday_lessons.length) return {
        text: `Наступний робочий день для групи ${group_data.group_name} не було знайдено.`,
        options: {
            parse_mode: 'HTML',
        }
    }
    return {
        text: `<b>Пари на ${nextday_params.lesson_date.format('DD.MM')} (${DAY_NAMES[nextday_params.day_weekday].toLowerCase()}) у групи ${group_data.group_name}:</b>\n\n`
        + formatDayLessons(nextday_params, nextday_lessons, chat_data.chat_hide_teachers),
        options: {
            parse_mode: 'HTML'
        }
    }
}

/**
 * @param {import("./group-data-manager").CurrentWeekScheduleResult} schedule_data 
 * @param {import("./group-data-manager").Group} group_data
 * @param {import('./chat-data-manager').Chat} chat_data 
 * @returns {{text: string, options: TelegramBot.SendMessageOptions}}
 */
function formatCurrentWeekLessons(schedule_data, group_data, chat_data, hide_teachers){
    let {current_week_lessons, current_params} = schedule_data;
    let is_so_big = false;
    let text = `<b>${current_params.day_week === 1 ? 'Перший' : "Другий"} тиждень (поточний) у групи ${group_data.group_name}:</b>\n\n`;
    let formatted = formatWeekLessons(current_params, current_week_lessons, hide_teachers);
    if (text.length + formatted.length > 4096) {
        is_so_big = true;
        formatted = formatWeekLessons(current_params, current_week_lessons, false);
    }
    let keyboard = [{
        text: `${current_params.day_week === 1 ? 'Другий' : "Перший"} тиждень`,
        callback_data: createCallbackData(current_params.day_week === 1 ? 'week_second' : "week_first", {group_data, chat_data, hide_teachers})
    }];
    if (!is_so_big){
        keyboard.push({
            text: hide_teachers ? `Відобразити вчителів` : `Сховати вчителів`,
            callback_data: createCallbackData(current_params.day_week === 1 ? 'week_first' : "week_second", {group_data, chat_data, hide_teachers: !hide_teachers})
        })
    }
    return {
        text: text + formatted,
        options: {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [keyboard]
            }
        }
    }
}
/**
 * @param {import("./group-data-manager").NextWeekScheduleResult} schedule_data 
 * @param {import("./group-data-manager").Group} group_data
 * @param {import('./chat-data-manager').Chat} chat_data 
 * @returns {{text: string, options: TelegramBot.SendMessageOptions}}
 */
function formatNextWeekLessons(schedule_data, group_data, chat_data, hide_teachers){
    let {next_week_lessons, current_params} = schedule_data;
    let is_so_big = false;
    let text = `<b>${current_params.day_week === 1 ? 'Другий' : "Перший"} тиждень (наступний) у групи ${group_data.group_name}:</b>\n\n`;
    let formatted = formatWeekLessons(current_params, next_week_lessons, hide_teachers);
    if (text.length + formatted.length > 4096) {
        is_so_big = true;
        formatted = formatWeekLessons(current_params, next_week_lessons, false);
    }
    let keyboard = [{
        text: `${current_params.day_week === 1 ? 'Перший' : "Другий"} тиждень`,
        callback_data: createCallbackData(current_params.day_week === 1 ? 'week_first' : "week_second", {group_data, chat_data, hide_teachers})
    }];
    if (!is_so_big){
        keyboard.push({
            text: hide_teachers ? `Відобразити вчителів` : `Сховати вчителів`,
            callback_data: createCallbackData(current_params.day_week === 1 ? 'week_second' : "week_first", {group_data, chat_data, hide_teachers: !hide_teachers})
        })
    }
    return {
        text: text + formatted,
        options: {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [keyboard]
            }
        }
    }
}

/**
 * @param {import("./group-data-manager").FirstWeekScheduleResult} schedule_data 
 * @param {import("./group-data-manager").Group} group_data
 * @param {import('./chat-data-manager').Chat} chat_data 
 * @returns {{text: string, options: TelegramBot.SendMessageOptions}}
 */
function formatFirstWeekLessons(schedule_data, group_data, chat_data, hide_teachers){
    let {first_week_lessons, current_params} = schedule_data;
    let is_so_big = false;
    let text = `<b>Перший тиждень (${current_params.day_week === 1 ? 'поточний' : 'наступний'}) у групи ${group_data.group_name}:</b>\n\n`;
    let formatted = formatWeekLessons(current_params, first_week_lessons, hide_teachers);
    if (text.length + formatted.length > 4096) {
        is_so_big = true;
        formatted = formatWeekLessons(current_params, first_week_lessons, false);
    }
    let keyboard = [{
        text: `Другий тиждень`,
        callback_data: createCallbackData("week_second", {group_data, chat_data, hide_teachers})
    }];
    if (!is_so_big){
        keyboard.push({
            text: hide_teachers ? `Відобразити вчителів` : `Сховати вчителів`,
            callback_data: createCallbackData('week_first', {group_data, chat_data, hide_teachers: !hide_teachers})
        })
    }
    return {
        text: text + formatted,
        options: {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [keyboard]
            }
        }
    }
}
/**
 * @param {import("./group-data-manager").SecondWeekScheduleResult} schedule_data 
 * @param {import("./group-data-manager").Group} group_data
 * @param {import('./chat-data-manager').Chat} chat_data 
 * @returns {{text: string, options: TelegramBot.SendMessageOptions}}
 */
function formatSecondWeekLessons(schedule_data, group_data, chat_data, hide_teachers){
    let {second_week_lessons, current_params} = schedule_data;
    let is_so_big = false;
    let text = `<b>Другий тиждень (${current_params.day_week === 1 ? 'наступний' : 'поточний'}) у групи ${group_data.group_name}:</b>\n\n`;
    let formatted = formatWeekLessons(current_params, second_week_lessons, hide_teachers);
    if (text.length + formatted.length > 4096) {
        is_so_big = true;
        formatted = formatWeekLessons(current_params, second_week_lessons, false);
    }
    let keyboard = [{
        text: `Перший тиждень`,
        callback_data: createCallbackData("week_first", {group_data, chat_data, hide_teachers})
    }];
    if (!is_so_big){
        keyboard.push({
            text: hide_teachers ? `Відобразити вчителів` : `Сховати вчителів`,
            callback_data: createCallbackData('week_second', {group_data, chat_data, hide_teachers: !hide_teachers})
        })
    }
    return {
        text: text + formatted,
        options: {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [keyboard]
            }
        }
    }
}

/**
 * @param {String} key 
 * @param {import('./group-data-manager').AnyScheduleResult} schedule_data 
 * @param {import('./group-data-manager').Group} group_data 
 * @param {import('./chat-data-manager').Chat} chat_data 
 * @returns {{text: string, options: TelegramBot.SendMessageOptions}}
 */
function formatScheduleData(key = "current", schedule_data, group_data, chat_data, hide_teachers){
    switch (key){
        case 'current': return formatCurrentLesson(schedule_data, group_data, chat_data)
        case 'before': return formatBeforeLesson(schedule_data, group_data, chat_data)
        case 'now': return formatNowLesson(schedule_data, group_data, chat_data)
        case 'next': return formatNextLesson(schedule_data, group_data, chat_data)
        case 'today': return formatTodayLessons(schedule_data, group_data, chat_data)
        case 'tomorrow': return formatTomorrowLessons(schedule_data, group_data, chat_data)
        case 'nextday': return formatNextDayLessons(schedule_data, group_data, chat_data)
        case 'week_current': return formatCurrentWeekLessons(schedule_data, group_data, chat_data, hide_teachers)
        case 'week_next': return formatNextWeekLessons(schedule_data, group_data, chat_data, hide_teachers)
        case 'week_first': return formatFirstWeekLessons(schedule_data, group_data, chat_data, hide_teachers)
        case 'week_second': return formatSecondWeekLessons(schedule_data, group_data, chat_data, hide_teachers)
    }
}

module.exports = { formatScheduleData }