const crypto = require('crypto');
const request = require('request');
const pg = require('pg');
const {moment, now, MessageChain, createCallbackData, KEY_GETTERS} = require('../modules/utils.js');
const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');
const parser = require('node-html-parser');
const parserOptions = {
    lowerCaseTagName: false,
    comment: false,
    blockTextElements: {
      script: true,
      noscript: true,
      style: true,
      pre: true,
    },
};

/**
 * @typedef ScheduleLesson
 * @type {Object}
 * @property {String} lesson_hash
 * @property {String} lesson_name
 * @property {String} lesson_type
 * @property {{
 *     room_name: String,
 *     room_latitude: String
 *     room_longitude: String
 * }[]} lesson_rooms
 * @property {{
 *     teacher_name: String,
 *     teacher_link: String
 * }[]} lesson_teachers
 */

/**
 * @typedef ScheduleDay
 * @type {(ScheduleLesson | undefined)[]}
 */

/**
 * @typedef ScheduleWeek
 * @type {ScheduleDay[] | []}
 */

/**
 * @typedef DateParams
 * @type {Object}
 *  
 * @property {moment.Moment} now_date
 * @property {moment.Moment} query_date
 * 
 * @property {String | null} day_weekend
 * @property {Boolean} day_is_shuffled
 * 
 * @property {Number} day_index
 * @property {Number} day_semester
 * @property {Number} day_week
 * @property {Number} day_weekday
 * 
 * @property {Number} lesson_number
 * @property {Boolean} lesson_is_brake
 * @property {moment.Moment} lesson_date
 */

/**
 * @typedef NextDateParams
 * @type {(DateParams & {is_valid: true}) | {is_valid: false, now_date: moment.Moment, query_date: moment.Moment}}
 */

class GroupManager{
    constructor(client, bot){
        this.separator = '#';

        this.teachers_data = {};
        this.weekends_days = {};
        this.weekends_ranges = [];
        this.shuffled_days = {};
        for (let i = 1; i < 13; i++){
            this.shuffled_days[i] = {};
        }

        /**
         * @type {Object<string, Group>}
         */
        this.groups_storage = {};
        /**
         * @type {Object<string, String>}
         */
        this.group_names_data = {};
         /**
         * @type {Object<string, List>}
         */
        this.lists_storage = {};
        /**
         * @type {Object<string, EmptyGroup>}
         */
        this.temp_storage = {};
        /**
         * @type {pg.Client}
         */
        this.client = client;
        /**
         * @type {TelegramBot}
         */
        this.bot = bot;
    }

    //--------------------------------

    /**
     * @param {String} group_name 
     * @param {Number} variant_number 
     * @returns {Group | List | EmptyGroup | null}
     */
    get(group_name, variant_number){
        group_name = group_name?.trim()?.toLowerCase();
        variant_number = Math.clamp(0, variant_number, 5);
        if (!group_name) return null;
        if (!variant_number) return this.groups_storage[this.group_names_data[group_name]] || this.lists_storage[group_name]?.at(0) || this.createEmpty(group_name, 0);
        return this.lists_storage[group_name]?.at(variant_number) || this.createEmpty(group_name, variant_number);
    }

    async getOrSearch(group_name, variant_number, onGroupSearchStart){
        var group_data = this.get(group_name, variant_number);
        if (!group_data) throw new Error('Group name not provided');
        if (group_data instanceof EmptyGroup) {
            if (typeof onGroupSearchStart === 'function') try {await onGroupSearchStart()} catch(e){}
            return await group_data.search()
        }
        return group_data;
    }
    /**
     * @param {String} group_name 
     * @param {Number} [variant_number] 
     * @param {Function} [onGroupSearchStart] 
     * @param {Function} [onScheduleUpdateStart] 
     * @returns {Promise<Group | List>}
     */
    async getOrSearchWithSchedule(group_name, variant_number, onGroupSearchStart, onScheduleUpdateStart){
        var group_data = this.get(group_name, variant_number);
        if (!group_data) throw new Error('Group name not provided');
        if (group_data.isEmpty()) {
            if (typeof onGroupSearchStart === 'function') try {await onGroupSearchStart()} catch(e){}
            group_data = await group_data.search();
        }
        if (group_data.isList()) return group_data;
        if (!group_data.is_fetched_schedule || !group_data.group_schedule.length) {
            if (typeof onScheduleUpdateStart === 'function') try {await onScheduleUpdateStart()} catch(e){}
            if (group_data.group_schedule.length){
                try {await group_data.updateSchedule(true)} catch(e){return group_data}
            } else await group_data.updateSchedule();
        }
        return group_data
    }
    /**
     * @param {TelegramBot.Message} msg 
     * @param {{
     *  group_name: string,
     *  group_variant_number: number,
     *  onListFound: Function,
     *  onGroupFound: Function
     * }} options 
     * @returns {Promise<void>}
     */
    async getGroupDataWithNotif(messager, options = {}){
        let {group_name, group_variant_number, onListFound, onGroupFound} = options;
        let group_data = await this.getOrSearch(group_name, group_variant_number, () => {
            return messager.send('Починаю пошук групи ' + group_name + '...');
        })
        if (group_data.isList()) {
            if (typeof onListFound !== 'function') onListFound = () => {
                return messager.send('Знайден список, але команда не допрацьована!\n' + group_data.getList().map((g, i) => {
                    return i === 0 ? '' : g.group_name;
                }).join('\n> ').trim())
            }
            return void await onListFound(group_data)
        }
        if (typeof onGroupFound !== 'function') onGroupFound = () => {
            if (group_data.isList()) return messager.send("Список " + group_data.group_name + ' був знайдений, однак команда не допрацьована!')
            if (group_data.isGroup()) return messager.send("Група " + group_data.group_name + ' була знайдена, однак команда не допрацьована!')
        }
        return void await onGroupFound(group_data)
    }
    /**
     * @param {{
     *  group_name: string,
     *  group_variant_number: number,
     *  edit_message: boolean,
     *  onListFound: Function,
     *  onScheduleFound: Function
     * }} options 
     * @returns {Promise<void>}
     */
    async getGroupDataWithScheduleAndNotif(messager, options = {}){
        let {group_name, group_variant_number, onListFound, onScheduleFound} = options;
        let group_data = await this.getOrSearchWithSchedule(group_name, group_variant_number, () => {
            return messager.send('Починаю пошук групи ' + group_name + '...');
        }, () => {
            return messager.send('Починаю пошук розкладу групи ' + group_name + '...');
        })
        if (group_data.isList()) {
            if (typeof onListFound !== 'function') onListFound = () => {
                return messager.send('Знайден список, але команда не допрацьована!\n' + group_data.getList().map((g, i) => {
                    return i === 0 ? '' : g.group_name;
                }).join('\n> ').trim())
            }
            return void await onListFound(group_data);
        }
        if (typeof onScheduleFound !== 'function') onScheduleFound = () => {
            return messager.send("Розклад групи " + group_data.group_name + ' був знайдений, однак команда не допрацьована!');
        }
        return void await onScheduleFound(group_data);
    }
    /**
     * @param {string} key
     * @param {{
     *  group_name: string,
     *  group_variant_number: number,
     *  hide_teachers: boolean,
     * }} options 
     * @returns {Promise<import('./group-data-manager.js').SearchScheduleResult>}
     */
    async getGroupSchedule(key, group_name, group_variant_number){
        let group_data = await this.getOrSearchWithSchedule(group_name, group_variant_number);
        if (group_data.isList()) return {is_list: true, group_data, schedule_data: null};
        return {group_data, schedule_data: group_data[KEY_GETTERS[key] || 'getCurrentLesson']()};
    }
    /**
     * @param {string} key
     * @param {{
     *  group_name: string,
     *  group_variant_number: number,
     *  edit_message: boolean,
     *  hide_teachers: boolean,
     * }} options 
     * @returns {Promise<import('./group-data-manager.js').NotifSearchScheduleResult>}
     */
    getGroupScheduleWithNotif(key, messager, options = {}){
        return new Promise((resolve, reject) => {
            options.onListFound = async group_data => {
                let inline_keyboard = [];
                group_data.getList().forEach((g, i) => {
                    if (i === 0) return;
                    inline_keyboard.push([{
                        text: g.group_name,
                        callback_data: createCallbackData(key, {group_data: g, hide_teachers: options.hide_teachers})
                    }])
                })
                await messager.send('Знайдено декілька варіантів.\nОберіть потрібний.', {
                    parse_mode: 'HTML',
                    reply_markup: {
                        resize_keyboard: true,
                        inline_keyboard
                    }
                })
                resolve({is_list: true, group_data, schedule_data: null, messager})
            }
            options.onScheduleFound = group_data => {
                resolve({group_data, schedule_data: group_data[KEY_GETTERS[key] || 'getCurrentLesson'](), messager});
            }
            this.getGroupDataWithScheduleAndNotif(messager, options).catch(reject)
        })
    }

    //--------------------------------

    /**
     * @param {Group | List} group_data 
     * @returns {Promise<Group | List>}
     */
    async save(group_data){
        if (!group_data) throw new Error('No data provided')
        if (group_data instanceof Group){
            let {group_id, group_viewstate, group_name, group_variant_number, group_parent_name, group_schedule} = group_data;
            group_schedule = group_schedule.map(day_data => {
                let result_object = {};
                day_data.forEach((lesson, index) => {
                    result_object[index] = lesson
                })
                return result_object;
            })
            await this.client.query(
                `INSERT INTO schedules_groups (group_id, group_viewstate, group_name, group_variant_number, group_parent_name, group_schedule) VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (group_id) DO UPDATE SET (group_viewstate, group_name, group_variant_number, group_parent_name, group_schedule) = ($2, $3, $4, $5, $6)`,
                [group_id, group_viewstate, group_name, group_variant_number, group_parent_name, group_schedule]
            )
            this.groups_storage[group_id] = group_data;
            this.group_names_data[group_name.trim().toLowerCase()] = group_id;
            if (group_parent_name){
                if (!this.lists_storage[group_parent_name]) this.lists_storage[group_parent_name] = [];
                this.lists_storage[group_parent_name][group_variant_number] = group_data;
            }
            return group_data;
        } else if (group_data instanceof List){
            let {group_name, group_ids_list} = group_data;
            await this.client.query(
                'INSERT INTO schedules_lists (group_name, group_ids_list) VALUES ($1, $2) ON CONFLICT (group_name) DO UPDATE SET group_ids_list = $2',
                [group_name, group_ids_list]
            )
            if (!this.lists_storage[group_name]) this.lists_storage[group_name] = [];
            this.lists_storage[group_name][0] = group_data;
            return group_data
        } else {
            throw new Error('Invalid data to saving: ' + group_data.toString())
        }
    }

    //--------------------------------

    /**
     * @param {Number} group_name 
     * @param {Number} [variant_number]
     * @returns {EmptyGroup}
     */
    createEmpty(group_name, variant_number){
        // Создаётся если не удалось найти нужную группу и/или вариант
        group_name = group_name.trim().toLowerCase();
        variant_number = Math.clamp(0, variant_number, 5);
        let group_data = new EmptyGroup(this, group_name, variant_number);
        if (!this.temp_storage[group_name]) this.temp_storage[group_name] = [];
        this.temp_storage[group_name][variant_number] = group_data;
        return group_data;
    }
    /**
     * @param {String} group_name 
     * @param {Number} [variant_number] 
     * @param {String} group_id 
     * @param {String} [group_parent_name] 
     * @returns {Group}
     */
    createGroup(group_name, variant_number, group_id, group_parent_name){
        return new Group(this, group_name.trim().toLowerCase(), variant_number, group_id, group_parent_name)
    }
    /**
     * @param {String} group_name 
     * @returns {List}
     */
    createList(group_name){
        return new List(this, group_name.trim().toLowerCase());
    }

    //--------------------------------

    createGroupFromDatabase(row){
        let d = new Group(this, row.group_name, row.group_variant_number, row.group_id, row.group_parent_name);
        this.group_names_data[d.group_name] = d.group_id;
        this.groups_storage[d.group_id] = d;
        d.group_name = row.group_name; // Для возвращения регистра
        d.group_viewstate = row.group_viewstate;
        d.group_schedule = this.createScheduleFromDatabase(row.group_schedule);
        return d;
    }
    createListFromDatabase(row){
        let d = new List(this, row.group_name);
        d.group_ids_list = row.group_ids_list;
        let list_array = [d];
        d.group_ids_list.forEach(g => {
            list_array.push(this.groups_storage[g])
        })
        if (list_array.every(g => g)) this.lists_storage[d.group_name] = list_array; // Если где-то дырка, то её надо залатать
        return d;
    }
    createScheduleFromDatabase(schedule_data){
        if (!schedule_data?.length) return []
        return schedule_data.map(day_data => {
            let result_array = [];
            for (let i in day_data){
                result_array[i] = day_data[i]
            }
            result_array.count = result_array.reduce(a => a + 1, 0)
            result_array.min = Math.max(result_array.findIndex(a => a), 0);
            result_array.max = result_array.reduce((c, a, i) => Math.max(i, c), 0)
            return result_array;
        })
    }
    async getDataFromDatabase(){
        let [groups_result, lists_result] = await Promise.all([
            this.client.query('SELECT * FROM schedules_groups'),
            this.client.query('SELECT * FROM schedules_lists'),
        ])
        groups_result.rows.forEach(this.createGroupFromDatabase, this)
        lists_result.rows.forEach(this.createListFromDatabase, this)
        return;
    }

    //--------------------------------

    /**
     * @param {moment.MomentInput} input 
     * @returns {DateParams}
     */
    getCurrentParams(input){
        let date = now(input);
        let day_semester = this.getSemesterNumber(false, date)
        let day_week = this.getWeekNumber(false, date);
        let day_weekday = date.isoWeekday();
        let day_seconds = date.hour() * 3600 + date.minute() * 60 + date.second();
        let lesson_seconds = Math.max((day_seconds - 29400) / 6900 + 1, 0);
        let lesson_number = Math.floor(lesson_seconds);
        let lesson_is_brake = (lesson_seconds - lesson_number) < 0.173913;
        if (lesson_number > 5){
            // Спасибо КПИ за такое класcное расписание пар
            if (Math.onRange(63901, day_seconds, 72300)) lesson_number = 6;
            if (Math.onRange(72301, day_seconds, 78900)) lesson_number = 7;
            if (day_seconds > 78900) lesson_number = 8;
            lesson_is_brake = Math.onRange(63901, day_seconds, 66000) || Math.onRange(72301, 73200);
        }
        let day_is_shuffled = false;
        let shuffle_data = this.getShuffleData(date);
        if (shuffle_data) {
            day_is_shuffled = true;
            day_week = this.getWeekNumber(shuffle_data.change_week_number, date);
            day_weekday = shuffle_data.day;
        };
        switch(lesson_number){
            case 1: case 2: case 3: case 4: case 5: lesson_seconds = 30600 + (lesson_number - 1) * 6900; break;
            case 6: lesson_seconds = 63900; break;
            case 7: lesson_seconds = 72300; break; // 72300
            default: lesson_seconds = 0; // Если пары нет - значит полуночь. А вот так, почему бы и нет
        }
        return {
            now_date: now(), query_date: now(input),
            day_weekend: this.getWeekendsData(date), day_is_shuffled, day_index: 14 * (day_semester - 1) + 7 * (day_week - 1) + day_weekday - 1, day_semester, day_week, day_weekday,
            lesson_number, lesson_is_brake, lesson_date: date.startOf('day').seconds(lesson_seconds)
        };
    }
    /**
     * @param {Boolean} invert 
     * @param {moment.MomentInput} date 
     * @returns {1 | 2}
     */
    getSemesterNumber(invert = false, date){
        date = now(date);
        if (invert) return 2 - (date.quarter() < 3)
        return 1 + (date.quarter() < 3)
    }
    /**
     * @param {Boolean} invert 
     * @param {moment.MomentInput} date 
     * @returns {1 | 2}
     */
    getWeekNumber(invert = false, date){
        date = now(date)
        let week_number = Math.floor((date - 1630270800000) / 604800000) % 2 + 1;
        if (invert) return week_number;
        return week_number === 1 ? 2 : 1;
    }
    /**
     * @param {moment.MomentInput} input 
     * @returns {DateParams}
     */
    getTomorrowParams(date){
        return this.getCurrentParams(now(date).add(1, 'day').startOf('day'))
    }
    /**
     * @param {moment.MomentInput} date 
     * @returns {String | null}
     */
    getWeekendsData(date){
        date = now(date);
        return this.weekends_days[date.format('DD.MM')]
        || this.weekends_ranges.find(range => {
            return date.isBetween(range.from, range.to)
        })?.text || null;
    }
    loadWeekendsData(json){
        this.weekends_days = json.days || {};
        this.weekends_ranges = [];
        Object.entries(json.ranges).forEach(([range, text]) => {
            if (range.indexOf('full') > -1){
                let month = Number(range.match(/full.([0-9]{2})/)[1]);
                this.weekends_ranges.push({
                    from: now().date(0).month(month - 1).startOf('day'),
                    to: now().date(0).month(month).endOf('day'),
                    text: text
                })
            }
            let range_match = range.match(/([0-9]{2}).([0-9]{2}) - ([0-9]{2}).([0-9]{2})/);
            if (range_match){
                this.weekends_ranges.push({
                    from: now().date(range_match[1]).month(range_match[2] - 1).startOf('day'),
                    to: now().date(range_match[3]).month(range_match[4] - 1).year(now().year() + (range_match[2] - 1 > range_match[4] - 1)).endOf('day'),
                    text: text
                })
            }
        })
    }
    /**
     * @param {moment.MomentInput} date 
     * @returns {{day: number, change_week_number: Boolean} | null}
     */
    getShuffleData(date){
        date = now(date);
        return this.shuffled_days[date.month() + 1][date.date()] || null;
    }
    loadShuffleData(json){
        this.shuffled_days = json || {};
        for (let i = 1; i < 13; i++){
            if (!this.shuffled_days[i]) this.shuffled_days[i] = {};
        }
    }

    loadTeachersData(json){
        this.teachers_data = json || {};
    }
}

class GroupBase{
    /**
     * @param {GroupManager} manager 
     * @param {String} group_name 
     * @param {Number} group_variant_number
     */
    constructor(manager, group_name, group_variant_number){
        this.manager = manager;
        this.group_name = group_name.trim().toLowerCase();
        this.group_variant_number = Math.clamp(0, group_variant_number, 5);
        this.group_parent_name = null;

        /**
         * @type {ScheduleDay[] | []}
         */
        this.group_schedule = [];
        this.is_fetched_schedule = false;
    }

    isEmpty(){
        return false
    }
    isList(){
        return false
    }
    isGroup(){
        return false
    }

    /**
     * @returns {[List, ...Group[]]}
     */
    getList(){
        return []
    }
    /**
     * @param {Number} variant_number 
     * @returns {Group | List}
     */
    getVariant(){
        return null
    }

    //--------------------------------

    __getSearchForm__(){
        return  {
            ctl00_ToolkitScriptManager_HiddenField: ";;AjaxControlToolkit, Version=3.5.60623.0, Culture=neutral, PublicKeyToken=28f01b0e84b6d53e::834c499a-b613-438c-a778-d32ab4976134:22eca927:ce87be9:2d27a0fe:23389d96:77aedcab:1bd6c8d4:7b704157",
            __VIEWSTATE: "/wEMDAwQAgAADgEMBQAMEAIAAA4BDAUDDBACAAAOAgwFBwwQAgwPAgEIQ3NzQ2xhc3MBD2J0biBidG4tcHJpbWFyeQEEXyFTQgUCAAAADAUNDBACAAAOAQwFAQwQAgAADgMMBQUMEAIMDwICAAABC21vYmlsZS1mb250AgIABQIAAAAMBQcMEAIPAQEaQ29tcGxldGlvbkxpc3RJdGVtQ3NzQ2xhc3MCAwAAAAwFDQwQAgwPAwEEVGV4dAEb0KDQvtC30LrQu9Cw0LQg0LfQsNC90Y/RgtGMAgAAAgMAAgIABQIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB9fAujPt/SsJ9t2yXnIeyRiM00d",
            __EVENTTARGET: "",
            __EVENTARGUMENT: "",
            ctl00$MainContent$ctl00$txtboxGroup: this.group_name.toLowerCase(),
            ctl00$MainContent$ctl00$btnShowSchedule: "Розклад занять",
            __EVENTVALIDATION: "/wEdAAEAAAD/////AQAAAAAAAAAPAQAAAAUAAAAIsA3rWl3AM+6E94I5Tu9cRJoVjv0LAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHfLZVQO6kVoZVPGurJN4JJIAuaU",
            hiddenInputToUpdateATBuffer_CommonToolkitScripts: 1
        }
    }
    /**
     * @returns {Promise<Group | List>}
     */
    __searchResultProcessor__(site_data){
        let group_id = site_data.match(/<h2>Object moved to <a href="\/Schedules\/ViewSchedule\.aspx\?g=(.*)">here<\/a><\/h2>/)?.at(1);
        if (group_id) {
            // Это группа - создаём её
            return this.manager.createGroup(this.group_name, this.group_variant_number, group_id).fetch();
        } else {
            // Это список - создаём его
            return this.manager.createList(this.group_name).fetch();
        }
    }
    /**
     * @returns {Promise<Group | List>}
     */
    search(){
        return new Promise((resolve, reject) => {
            if (this.group_variant_number) {
                this.manager.get(this.group_parent_name).search()
                .then(group_data => {
                    if (group_data instanceof Group) resolve(group_data)
                    if (group_data instanceof List) resolve(group_data.getVariant(this.group_variant_number))
                }, reject)
            } else {
                request.post('http://rozklad.kpi.ua/Schedules/ScheduleGroupSelection.aspx', {
                    timeout: 10000,
                    form: this.__getSearchForm__()
                }, (error, res, data) => {
                    if (data.includes('тимчасово недоступна')) return void reject(new Error('Connection to http://rozklad.kpi.ua failed'));
                    if (data.includes('Групи з такою назвою не знайдено!')) return void reject(new Error('Group Not Found'));
                    if (error?.message.includes('ETIMEDOUT')) return void reject(new Error('Connection timeout to http://rozklad.kpi.ua'));
                    if (error) return void reject(error);
                    this.__searchResultProcessor__(data).then(resolve, reject)
                })
            }
        })
    }

    //--------------------------------

    fetch(){
        return Promise.reject(new Error('Group Base cant be fetched'))
    }

    //--------------------------------

    /**
     * @param {moment.MomentInput} date
     */
    getCurrentParams(date){
        return this.manager.getCurrentParams(date)
    }
    /**
     * @param {moment.MomentInput} date
     */
    getTomorrowParams(date){
        return this.manager.getTomorrowParams(date)
    }
    /**
     * @param {Boolean} invert 
     * @param {moment.MomentInput} date 
     * @returns {1 | 2}
     */
    getSemesterNumber(invert = false, date){
        return this.manager.getSemesterNumber(invert, date)
    }
    /**
     * @param {Boolean} invert 
     * @param {moment.MomentInput} date 
     * @returns {1 | 2}
     */
    getWeekNumber(invert = false, date){
        return this.manager.getWeekNumber(invert, date)
    }
    /**
     * @param {moment.MomentInput} date
     * @returns {NextDateParams}
     */
    getNextParams(date){
        if (!this.group_schedule?.length) return {now_date: now(), query_date: now(date), is_valid: false};
        let {lesson_date, day_index, day_semester, day_week, day_weekday, lesson_number, lesson_is_brake, day_weekend, day_is_shuffled} = this.getCurrentParams(date);
        let iterations_count = 0;
        let process_day;
        do{
            if (iterations_count++ > 90) return {now_date: now(), query_date: now(date), is_valid: false};
            process_day = this.group_schedule[day_index];
            if (lesson_is_brake){
                lesson_is_brake = false;
            } else if (day_weekday > 6 || day_weekend || process_day.count === 0 || lesson_number > process_day.max){
                day_is_shuffled = false
                lesson_date.add(1, 'day');
                day_semester = this.getSemesterNumber(false, lesson_date)
                day_week = this.getWeekNumber(false, lesson_date);
                day_weekday = lesson_date.isoWeekday();
                day_weekend = this.manager.getWeekendsData(lesson_date);
                let schuffle_data = this.manager.getShuffleData(lesson_date);
                if (schuffle_data) {
                    day_is_shuffled = true;
                    day_week = this.getWeekNumber(schuffle_data.change_week_number, lesson_date);
                    day_weekday = schuffle_data.day;
                }
                day_index = 14 * (day_semester - 1) + 7 * (day_week - 1) + day_weekday - 1;
                process_day = this.group_schedule[day_index];
                lesson_number = process_day.min;
            } else {
                lesson_number++;
            }
        }
        while(day_weekend || !process_day[lesson_number])
        let lesson_seconds;
        switch(lesson_number){
            case 6: lesson_seconds = 66600; break;
            case 7: lesson_seconds = 73200; break;
            case 8: lesson_seconds = 79200; break;
            default: lesson_seconds = 30600 + (lesson_number - 1) * 6900; break;
        }
        return {
            is_valid: true,
            now_date: now(), query_date: now(date),
            day_weekend: null, day_is_shuffled, day_index, day_semester, day_week, day_weekday,
            lesson_number, lesson_is_brake: false, lesson_date: lesson_date.startOf('day').seconds(lesson_seconds), 
        }
    }

    //--------------------------------

    /**
     * @typedef ScheduleCurrentData
     * @type {Object}
     * @property {Boolean} is_contain_schedule
     * @property {DateParams} current_params
     * @property {ScheduleLesson | null} current_lesson
     */

    /**
     * @param {moment.MomentInput} date 
     * @returns {ScheduleCurrentData}
     */
    getCurrentLesson(date){
        let current_params = this.getCurrentParams(date);
        if (!this.group_schedule?.length) return {
            is_contain_schedule: false,
            current_params, current_lesson: null
        }
        return {
            is_contain_schedule: true,
            current_params, current_lesson: this.group_schedule[current_params.day_index]?.at(current_params.lesson_number) || null
        }
    }

    /**
     * @param {moment.MomentInput} date 
     * @returns {ScheduleNextData}
     */
    getNextLesson(date){
        let current_params = this.getCurrentParams(date);
        let next_params = this.getNextParams(date);
        if (!this.group_schedule?.length) return {
            is_contain_schedule: false,
            current_params, next_params, next_lesson: null,
        }
        return {
            is_contain_schedule: true,
            current_params, next_params, next_lesson: this.group_schedule[next_params.day_index]?.at(next_params.lesson_number) || null
        }
    }

    /**
     * @param {moment.MomentInput} date 
     * @returns {{
     *      is_contain_schedule: Boolean
     *      current_params: DateParams,
     *      today_lessons: ScheduleDay,
     * }}
     */
    getTodayLessons(date){
        let current_params = this.getCurrentParams(date);
        let empty_result = [];
        empty_result.count = empty_result.min = empty_result.max = 0;
        if (!this.group_schedule?.length) return {
            is_contain_schedule: false,
            current_params, today_lessons: empty_result
        }
        return {
            is_contain_schedule: true,
            current_params, today_lessons: this.group_schedule[current_params.day_index] || empty_result
        }
    }
    /**
     * @param {moment.MomentInput} date 
     * @returns {{
     *      is_contain_schedule: Boolean
     *      current_params: DateParams,
     *      tomorrow_params: DateParams,
     *      tomorrow_lessons: ScheduleDay,
     * }} 
     */
    getTomorrowLessons(date){
        let current_params = this.getCurrentParams(date);
        let tomorrow_params = this.getCurrentParams(now(date).add(1, 'day').startOf('day'));
        let empty_result = [];
        empty_result.count = empty_result.min = empty_result.max = 0;
        if (!this.group_schedule?.length) return {
            is_contain_schedule: false,
            current_params, tomorrow_params, tomorrow_lessons: empty_result
        }
        return {
            is_contain_schedule: false,
            current_params, tomorrow_params, tomorrow_lessons: this.group_schedule[tomorrow_params.day_index] || empty_result
        }
    }
    /**
     * @param {moment.MomentInput} date 
     * @returns {{
     *      is_contain_schedule: Boolean
     *      current_params: DateParams,
     *      nextday_params: NextDateParams,
     *      nextday_lessons: ScheduleDay,
     * }}
     */
    getNextDayLessons(date){
        let current_params = this.getCurrentParams(date);
        let nextday_params = this.getNextParams(date);
        // Если оно валидное, и это один и тот же день и пара не нулевая - ищем начиная с завтра
        if (nextday_params.is_valid && current_params.lesson_date.isSame(nextday_params.lesson_date, 'day') && current_params.lesson_number > 0) {
            nextday_params = this.getNextParams(now(date).add(1, 'day'));
        }
        let empty_result = [];
        empty_result.count = empty_result.min = empty_result.max = 0;
        if (!this.group_schedule?.length) return {
            is_contain_schedule: false,
            current_params, nextday_params, nextday_lessons: empty_result,
        }
        return {
            is_contain_schedule: true,
            current_params, nextday_params, nextday_lessons: this.group_schedule[nextday_params.day_index] || empty_result
        }
    }

    /**
     * @param {moment.MomentInput} date 
     * @returns {{
     *      is_contain_schedule: Boolean
     *      current_params: DateParams,
     *      current_week_lessons: ScheduleWeek
     * }}
     */
    getCurrentWeekLessons(date){
        let current_params = this.getCurrentParams(date);
        if (!this.group_schedule?.length) return {
            is_contain_schedule: false,
            current_params, current_week_lessons: []
        }
        let start_index = (current_params.day_semester - 1) * 14 + (current_params.day_week - 1) * 7;
        let end_index = start_index + 7;
        return {
            is_contain_schedule: false,
            current_params, current_week_lessons: this.group_schedule.slice(start_index, end_index)
        }
    }
    /**
     * @param {moment.MomentInput} date 
     * @returns {{
     *      is_contain_schedule: Boolean
     *      current_params: DateParams,
     *      next_week_params: DateParams,
     *      next_week_lessons: ScheduleWeek
     * }}
     */
    getNextWeekLessons(date){
        let current_params = this.getCurrentParams(date);
        let next_week_params = this.getCurrentParams(now(date).add(1, 'week').startOf('week').add(1, 'day'));
        if (!this.group_schedule?.length) return {
            is_contain_schedule: false,
            current_params, next_week_params, next_week_lessons: []
        }
        let start_index = (next_week_params.day_semester - 1) * 14 + (next_week_params.day_week - 1) * 7;
        let end_index = start_index + 7;
        return {
            is_contain_schedule: false,
            current_params, next_week_params, next_week_lessons: this.group_schedule.slice(start_index, end_index)
        }
    }

    /**
     * @param {moment.MomentInput} date 
     * @returns {{
     *      is_contain_schedule: Boolean
     *      current_params: DateParams,
     *      first_week_lessons: ScheduleWeek
     * }}
     */
    getFirstWeekLessons(date){
        let current_params = this.getCurrentParams(date);
        if (!this.group_schedule?.length) return {
            is_contain_schedule: false,
            current_params, first_week_lessons: []
        }
        let start_index = (current_params.day_semester - 1) * 14;
        let end_index = start_index + 7;
        return {
            is_contain_schedule: false,
            current_params, first_week_lessons: this.group_schedule.slice(start_index, end_index)
        }
    }
    /**
     * @param {moment.MomentInput} date 
     * @returns {{
     *      is_contain_schedule: Boolean
     *      current_params: DateParams,
     *      second_week_lessons: ScheduleWeek
     * }}
     */
    getSecondWeekLessons(date){
        let current_params = this.getCurrentParams(date);
        if (!this.group_schedule?.length) return {
            is_contain_schedule: false,
            current_params, second_week_lessons: []
        }
        let start_index = (current_params.day_semester - 1) * 14 + 7;
        let end_index = start_index + 7;
        return {
            is_contain_schedule: false,
            current_params, second_week_lessons: this.group_schedule.slice(start_index, end_index)
        }
    }

    getFullSchedule(){
        return this.group_schedule
    }
    /**
     * @param {moment.MomentInput} date 
     * @returns {{
     *      is_contain_schedule: Boolean
     * 
     *      current_params: DateParams,
     *      next_params: NextDateParams,
     *      tomorrow_params: DateParams,
     *      nextday_params: NextDateParams,
     *      next_week_params: DateParams.
     *      
     *      current_lesson: ScheduleLesson | null,
     *      next_lesson: ScheduleLesson | null,
     *      today_lessons: ScheduleDay,
     *      tomorrow_lessons: ScheduleDay,
     *      next_week_lessons: ScheduleDay,
     * 
     *      current_week_lessons: ScheduleWeek
     *      next_week_lessons: ScheduleWeek
     * }}
     */
    getAllLessonsData(date){
        let current_params = this.getCurrentParams(date);
        let next_params = this.getNextParams(date);
        let tomorrow_params = this.getCurrentParams(now(date).add(1, 'day').startOf('day'));
        let nextday_params = next_params;
        // Если оно валидное, и это один и тот же день и пара не нулевая - ищем начиная с завтра
        if (nextday_params.is_valid && current_params.lesson_date.isSame(nextday_params.lesson_date, 'day') && current_params.lesson_number > 0) {
            nextday_params = this.getNextParams(now(date).add(1, 'day'))
        }
        let empty_result = [];
        empty_result.count = empty_result.min = empty_result.max = 0;
        let next_week_params = this.getCurrentParams(now(date).add(1, 'week').startOf('week').add(1, 'day'));
        if (!this.group_schedule?.length) return {
            is_contain_schedule: false,
            schedule: [],
            current_params, next_params, tomorrow_params, nextday_params, next_week_params,
            current_lesson: null, next_lesson: null,
            today_lessons: empty_result, tomorrow_lessons: empty_result, nextday_lessons: empty_result,
            current_week_lessons: [], next_week_lessons: []
        }
        let current_start_index = (current_params.day_semester - 1) * 14 + (current_params.day_week - 1) * 7;
        let current_end_index = current_start_index + 7;
        let next_start_index = (next_week_params.day_semester - 1) * 14 + (next_week_params.day_week - 1) * 7;
        let next_end_index = next_start_index + 7;
        return {
            is_contain_schedule: true,
            schedule: this.group_schedule || [],
            current_params, next_params, tomorrow_params, nextday_params, next_week_params,
            current_lesson: this.group_schedule[current_params.day_index]?.at(current_params.lesson_number) || null,
            next_lesson: this.group_schedule[next_params.day_index]?.at(next_params.lesson_number) || null,
            today_lessons: this.group_schedule[current_params.day_index] || empty_result,
            tomorrow_lessons: this.group_schedule[tomorrow_params.day_index] || empty_result,
            nextday_lessons: this.group_schedule[nextday_params.day_index] || empty_result,
            current_week_lessons: this.group_schedule.slice(current_start_index, current_end_index),
            next_week_lessons: this.group_schedule.slice(next_start_index, next_end_index)
        }
    }
}
class EmptyGroup extends GroupBase{
    /**
     * @param {GroupManager} manager 
     * @param {String} group_name 
     * @param {Number} [group_variant_number] 
     */
    constructor(manager, group_name, group_variant_number){
        super(manager, group_name, group_variant_number)
        this.group_parent_name = group_name;
    }

    //--------------------------------

    isEmpty(){
        return true
    }

    //--------------------------------

    fetch(){
        return Promise.reject(new Error('Empty Group cant be fetched'))
    }
}
class Group extends GroupBase{
    /**
     * @param {GroupManager} manager 
     * @param {String} group_name 
     * @param {Number} [group_variant_number]
     * @param {String} group_id
     * @param {String} [group_parent_name]
     */
    constructor(manager, group_name, group_variant_number, group_id, group_parent_name){
        super(manager, group_name, group_variant_number)
        
        this.group_id = group_id;
        this.group_viewstate = null;

        // Для вариантов
        this.group_parent_name = group_parent_name || null;
    }

    //--------------------------------

    isGroup(){
        return true
    }
    
    //--------------------------------

    /**
     * @returns {Promise<Group | List>}
     */
    fetch(){
        return new Promise((resolve, reject) => {
            fetch('http://rozklad.kpi.ua/Schedules/ViewSchedule.aspx?g=' + this.group_id)
            .then(response => {
                if (response?.ok) return response.text()
            }, reject)
            .then(data => {
                if (!data) return;
                if (data.includes('тимчасово недоступна')) return void reject(new Error('Connection Error'));
                let document = parser.parse(data, parserOptions);
                let viewstate = document.querySelector('#__VIEWSTATE').getAttribute('value');
                let group_name = document.querySelector('#ctl00_MainContent_lblHeader').innerHTML.replace('Розклад занять для ', "").trim() || null;
                let full_group_name = this.group_name?.toLowerCase() === group_name?.toLowerCase() ? group_name : (this.group_name || group_name);
                this.applyGroupData(full_group_name, viewstate, this.group_variant_number, this.group_parent_name).then(resolve, reject);
            }, reject)
        })
    }

    //--------------------------------

    __getScheduleForm__(semester_number){
        return {
            ctl00_ToolkitScriptManager_HiddenField: "",
            __VIEWSTATE: this.group_viewstate,
            __EVENTTARGET: "ctl00$MainContent$ddlSemesterType",
            __EVENTVALIDATION: "/wEdAAEAAAD/////AQAAAAAAAAAPAQAAAAYAAAAIsA3rWl3AM+6E94I5ke7WZqDu1maj7tZmCwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAANqZqakPTbOP2+koNozn1gOvqUEW",
            __EVENTARGUMENT: "",
            ctl00$MainContent$ddlSemesterType: String(semester_number)
        }
    }
    __updateScheduleSemester__(schedule_array, semester_number, quick){
        return new Promise((resolve, reject) => {
            request.post('http://rozklad.kpi.ua/Schedules/ViewSchedule.aspx?g=' + this.group_id, {
                form: this.__getScheduleForm__(semester_number),
                timeout: quick ? 5000 : 15000
            }, (error, r, data) => {
                if (error) return void reject(error);
                let document = parser.parse(data, parserOptions);
                let temp_object = {};
                document.querySelectorAll('table tr:not(:first-child) td:not(:first-child)').forEach((td, element_index) => {
                    if (!td.firstChild) return;
                    let lesson_week = element_index > 35 ? 1 : 0;
                    let lesson_day = element_index % 6;
                    let lesson_array_index = 14 * (semester_number - 1) + 7 * lesson_week + lesson_day;
                    let lesson_number = Math.ceil((element_index + 1) / 6) - (element_index > 35 ? 6 : 0);
                    let lesson_hash = crypto.createHash('md5').update(String(semester_number) + ':' + td.innerText).digest('hex')
                    if (temp_object[lesson_hash]){
                        schedule_array[lesson_array_index][lesson_number] = JSON.parse(JSON.stringify(temp_object[lesson_hash]));
                        return;
                    }
                    let lesson_data = {
                        lesson_type: '',
                        lesson_hash: lesson_hash,
                        lesson_name: td.firstChild.textContent,
                        lesson_rooms: [],
                        lesson_teachers: []
                    };

                    let last = td.lastChild.textContent;
                    if (last.match(/Лек/i)) {lesson_data.lesson_type = 'Лек'}
                    else if (last.match(/Прак/i)) {lesson_data.lesson_type = 'Прак'}
                    else if (last.match(/Лаб/i)) {lesson_data.lesson_type = 'Лаб'}
                    if (last.match(/on-line/i)) lesson_data.lesson_type = (lesson_data.lesson_type + ' online').trim();

                    td.getElementsByTagName('a').forEach(link => {
                        if (link.getAttribute('href').includes('/Schedules')){
                            let n = link.innerHTML.substring(link.innerHTML.match(/[А-ЯЄЇІ]/).index);
                            lesson_data.lesson_teachers.push({
                                teacher_name: this.manager.teachers_data[n] || n,
                                teacher_link: 'http://rozklad.kpi.ua' + link.getAttribute('href')
                            })
                        }
                        if (link.getAttribute('href').includes('maps.google')){
                            let room = {room_name: link.innerHTML.split(' ')[0]}
                            let match = link.getAttribute('href').match(/q=(.*),(.*)/);
                            if (match) {
                                room.room_latitude = match[1];
                                room.room_longitude = match[2];
                            }
                            lesson_data.lesson_rooms.push(room)
                        }
                    })
                    schedule_array[lesson_array_index][lesson_number] = lesson_data;
                    temp_object[lesson_hash] = lesson_data;
                })
                resolve()
            })
        })
    }
    async updateSchedule(quick){
        let result_array = [];
        for(let i = 0; i < 28; i++){
            result_array.push([])
        }
        await Promise.all([
            this.__updateScheduleSemester__(result_array, 1, quick),
            this.__updateScheduleSemester__(result_array, 2, quick),
        ])
        result_array.forEach(day => {
            day.count = day.reduce(a => a + 1, 0)
            day.min = Math.max(day.findIndex(a => a), 0);
            day.max = day.reduce((c, a, i) => Math.max(i, c), 0)
        })
        this.group_schedule = result_array;
        this.is_fetched_schedule = true;
        return await this.manager.save(this);
    }

    //--------------------------------

    applyGroupData(group_name, group_viewstate, group_variant_number, group_parent_name){
        this.group_name = group_name;
        this.group_viewstate = group_viewstate;
        this.group_variant_number = group_variant_number;
        this.group_parent_name = group_parent_name || null;
        return this.manager.save(this);
    }
}
class List extends GroupBase{
    /**
     * @param {GroupManager} manager 
     * @param {String} group_name 
     * @param {Number} [group_variant_number]
     */
    constructor(manager, group_name){
        super(manager, group_name)
        this.group_ids_list = [];
    }

    //--------------------------------

    isList(){
        return true
    }

    //--------------------------------

    /**
     * @returns {Promise<Group | List>}
     */
    __fetchResultPreprocessor__(site_data){
        return new Promise((resolve, reject) => {
            let links = parser.parse(site_data, parserOptions).querySelectorAll('#ctl00_MainContent_ctl00_GroupListPanel a');
            let list_to_process = links.map((link, group_variant_number) => {
                return {
                    group_name: link.textContent.trim(),
                    group_id: link.getAttribute('href').replace('ViewSchedule.aspx?g=', '').replace('&mobile=true', ''),
                    group_parent_name: this.group_name,
                    group_variant_number: group_variant_number + 1,
                }
            });
            let result_list = [];
            const iterator = () => {
                if (!list_to_process.length) {
                    // Список весь обработан
                    return void this.applyListData(result_list).then(resolve, reject);
                };
                let {group_name, group_variant_number, group_id, group_parent_name} = list_to_process.shift();
                let group_data = this.manager.createGroup(group_name, group_variant_number, group_id, group_parent_name);
                group_data.group_name = group_name; // Для сохранения регистра
                group_data.fetch().then(() => {
                    result_list.push(group_data);
                    iterator();
                }, reject)
            }
            iterator();
        })
    }
    /**
     * @returns {Promise<Group | List>}
     */
    fetch(){
        return new Promise((resolve, reject) => {
            request.post('http://rozklad.kpi.ua/Schedules/ScheduleGroupSelection.aspx', {
                timeout: 10000,
                form: this.__getSearchForm__()
            }, (error, res, data) => {
                if (error) return void reject(error);
                if (data.includes('тимчасово недоступна')) return void reject(new Error('Connection Error'));
                this.__fetchResultPreprocessor__(data).then(resolve, reject)
            })
        })
    }
    /**
     * @param {Number} variant_number 
     * @returns {Group | List}
     */
    getVariant(variant_number){
        if (!variant_number) return this;
        return this.manager.lists_storage[this.group_name]?.at(variant_number)
    }
    /**
     * @returns {[List, ...Group[]]}
     */
    getList(){
        return this.manager.lists_storage[this.group_name]
    }

    //--------------------------------

    applyListData(groups_list){
        this.group_ids_list = groups_list.map(e => {
            if (e instanceof Group) return e.group_id;
            if (typeof e === 'string') return e;
            return null;
        })
        return this.manager.save(this);
    }
}

module.exports = { GroupManager };



// CREATE TABLE schedules_groups(
// 	group_id char(36) NOT NULL UNIQUE,
// 	group_viewstate text NOT NULL,
// 	group_name varchar(16) NOT NULL,
	
// 	group_variant_number integer,
// 	group_parent_name varchar(16),

// 	group_schedule JSONB[][]
// )

// CREATE TABLE schedules_lists(
// 	group_name varchar(16) NOT NULL UNIQUE,
// 	group_ids_list text[]
// )