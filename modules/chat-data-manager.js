const TelegramBot = require("node-telegram-bot-api");
const { CHAT_TOGGLERS, MessageChain, createCallbackData, now } = require('./utils')
const pg = require('pg');

class ChatManager{
    constructor(client, bot){
        /**
         * @type {TelegramBot}
         */
        this.bot = bot;
        /**
         * @type {pg.Client}
         */
        this.client = client;

        this.chats_data = {}
    }
    /**
     * @param {string | number} chat_id 
     * @returns {Chat}
     */
    createUser(chat_id){
        let chat_data = new Chat(this, chat_id)
        this.chats_data[chat_id] = chat_data
        return chat_data;
    }
    /**
     * @param {string | number} chat_id 
     * @returns {Chat}
     */
    get(chat_id){
        if (!chat_id) return null;
        return this.chats_data[chat_id] || this.createUser(chat_id)
    }

    /**
     * @param {string | number} chat_id 
     * @param {string | number} user_id 
     * @returns {Promise<boolean>}
     */
    async isAdmin(chat_id, user_id){
        if (chat_id === user_id) return true;
        let member = await this.bot.getChatMember(chat_id, user_id)
        return ['administrator', 'creator'].includes(member.status)
    }

    async save(chat_data){
        if (chat_data instanceof Chat){
            let {chat_id, chat_group_name, chat_hide_teachers, chat_ignore_links, chat_links_parent_id, chat_before_notifications, chat_now_notifications, chat_links_data} = chat_data;
            let n = now();
            for (let hash in chat_links_data){
                chat_links_data[hash] = chat_links_data[hash].filter(link => {
                    return link && now(link.link_expire_date) > n;
                })
                if (!chat_links_data[hash].length && hash !== 'temp') delete chat_links_data[hash];
            }
            await this.client.query(`INSERT INTO chats_data (chat_id, chat_group_name, chat_hide_teachers, chat_ignore_links, chat_links_parent_id, chat_before_notifications, chat_now_notifications, chat_links_data)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (chat_id) DO UPDATE
            SET (chat_group_name, chat_hide_teachers, chat_ignore_links, chat_links_parent_id, chat_before_notifications, chat_now_notifications, chat_links_data) = ($2, $3, $4, $5, $6, $7, $8)`,
            [chat_id, chat_group_name || null, chat_hide_teachers || false, chat_ignore_links || false, chat_links_parent_id || null, chat_before_notifications || false, chat_now_notifications || false, chat_links_data || {}])
        }
    }

    //---------------------------

    createChatFromDatabase(row){
        let {chat_id, chat_group_name, chat_hide_teachers, chat_ignore_links, chat_links_parent_id, chat_before_notifications, chat_now_notifications, chat_links_data} = row;
        let d = new Chat(this, chat_id);
        d.chat_group_name = chat_group_name || null;
        d.chat_hide_teachers = !!chat_hide_teachers;
        d.chat_ignore_links = !!chat_ignore_links;
        d.chat_links_parent_id = chat_links_parent_id || null;
        d.chat_before_notifications = !!chat_before_notifications;
        d.chat_now_notifications = !!chat_now_notifications;
        d.chat_links_data = chat_links_data || {temp: []};
        this.chats_data[chat_id] = d;
        return d;
    }

    async getDataFromDatabase(){
        let chats_result = await this.client.query('SELECT * FROM chats_data');
        chats_result.rows.forEach(this.createChatFromDatabase, this)
        return;
    }
}

class Chat{
    /**
     * @param {ChatManager} manager 
     * @param {string | number} chat_id 
     */
    constructor(manager, chat_id){
        /**
         * @type {ChatManager}
         */
        this.manager = manager;
        /**
         * @type {number}
         */
        this.chat_id = +chat_id;
        /**
         * @type {String | null}
         */
        this.chat_group_name = null;
        this.chat_hide_teachers = false;

        this.chat_ignore_links = false;
        this.chat_links_parent_id = false;

        this.chat_before_notifications = false;
        this.chat_now_notifications = false;

        /**
         * @type {Object<string, import("./chat-data-manager").ChatLinkData[]>}
         */
        this.chat_links_data = {temp: []};
    }

    /**
     * @param {import('./group-data-manager').Group} group_data 
     * @param {string | number} user_id
     */
    async bind(user_id, group_data, checked = false){
        if (!group_data.isGroup()) reject(new Error('Invalid Group type'))
        if (!checked && !await this.isAdmin(user_id)) throw new Error('Forbidden')
        this.chat_group_name = group_data.group_name;
        return this.save()
    }
    /**
     * @param {import('./group-data-manager').Group} group_data 
     */
    async unbind(user_id, checked = false){
        if (!checked && !await this.isAdmin(user_id)) throw new Error('Forbidden')
        this.chat_group_name = null;
        return this.save()
    }
    async toggle(user_id, key, value, checked = false){
        if (!Object.keys(CHAT_TOGGLERS).includes(key)) throw new Error('Invalid Chat toggle key')
        if (!checked && !await this.isAdmin(user_id)) throw new Error('Forbidden')
        this['chat_' + key] = value !== undefined ? !!value : !this['chat_' + key];
        return await this.save()
    }

    //---------------------------

    async sendSettings(messager, user_id, query_id, checked = false){
        if (!checked && !await this.isAdmin(user_id)) {
            return void await query_id ?
            messager.bot.answerCallbackQuery(query_id, {
                text: '⚠️ Для цього потрібно мати права адміністратора у цьому чаті.'
            }) :
            messager.send('⚠️ Для цього потрібно мати права адміністратора у цьому чаті.')
        }
      
        let t = `<b>Налаштування боту у цьому чаті:</b>\n\n`
        t += 'Група: ' + (this.chat_group_name ? `<b>${this.chat_group_name}</b>, /unbind щоб прибрати` : `<i>Не обрана</i>, /bind щоб обрати`) + '\n\n';
        t += (!this.chat_hide_teachers ? '🟢' : '🔴') + ' Відображати вчителів у разкладах днів та тижнів\n';
        t += (this.chat_before_notifications ? '🟢' : '🔴') + ' Оповіщення за 15 хв. перед початком пари\n';
        t += (this.chat_now_notifications ? '🟢' : '🔴') + ' Оповіщення про початок пари\n';
        t += (!this.chat_ignore_links ? '🟢' : '🔴') + ' Помічати посилання на дистанційні пари\n';
        if (this.chat_links_parent_id) t += '🟢 Наявні посилання з іншого чату\n';     

        let inline_keyboard = [
            [{
                text: this.chat_hide_teachers ? "Відображати вчителів" : "Не відображати вчителів",
                callback_data: createCallbackData('hide_teachers')
            }],
            [{
                text: this.chat_before_notifications ? "Не надсилати оповіщення перед початком пар" : "Надсилати оповіщення перед початком пар",
                callback_data: createCallbackData('before_notifications')
            }],
            [{
                text: this.chat_now_notifications ? "Не надсилати оповіщення про початок пар" : "Надсилати оповіщення про початок пар",
                callback_data: createCallbackData('now_notifications')
            }],
            [{
                text: this.chat_ignore_links ? "Помічати посилання" : "Не помічати посилання",
                callback_data: createCallbackData('ignore_links')
            }],
            [{
                text: 'Закрити це меню',
                callback_data: 'close'
            }]
        ];
        if (this.chat_links_parent_id) inline_keyboard.splice(-1, 0, [{
            text: 'Видалити посилання іншого чату',
            callback_data: 'links_parent_delete'
        }])
        return void await messager.send(t, {
            parse_mode: 'HTML',
            reply_markup: {
                resize_keyboard: true,
                inline_keyboard
            }
        })
    }
    async sendBind(messager, group_data, user_id, query_id, checked = false){
        if (!checked && !await this.isAdmin(user_id)) {
            return void await query_id ?
            messager.bot.answerCallbackQuery(query_id, {
                text: '⚠️ Для цього потрібно мати права адміністратора у цьому чаті.'
            }) :
            messager.send('⚠️ Для цього потрібно мати права адміністратора у цьому чаті.')
        }
        await this.bind(user_id, group_data, true)
        return void await messager.send('Група успішно змінена на ' + group_data.group_name + '.');
    }
    async sendLinksDelete(lesson_hash, messager){
        if (!lesson_hash) return void await messager.send('Зараз ніякої пари немає.')
        let chat_links = this.getLinks(lesson_hash);
        let inline_keyboard = [];
        chat_links.forEach((link, link_index) => {
            if (now(link.link_expire_date) < now()) return;
            inline_keyboard.push([{
                text: link.link_title,
                callback_data: createCallbackData('link_delete', {lesson_hash, link_index})
            }])
        })
        if (!inline_keyboard.length) return void await messager.send(messager.message_id ? "На цю пару посилань більше немає." : 'На цю пару посилань немає.')
        inline_keyboard.push([{
            text: 'Закрити це меню',
            callback_data: 'close'
        }])
        return void await messager.send('Виберіть посилання, які хочете видалити.', {
            reply_markup: {
                inline_keyboard
            }
        })
    }

    //---------------------------

    /**
     * @param {string | number} user_id 
     * @returns {Promise<boolean>}
     */
    isAdmin(user_id){
        return this.manager.isAdmin(this.chat_id, user_id)
    }

    //---------------------------

    async addTempLink(link_data){
        if (!this.chat_links_data.temp) this.chat_links_data.temp = [];
        let length = this.chat_links_data.temp.push(link_data);
        await this.save();
        return length - 1;
    }
    async removeTempLink(link_id){
        if (!this.chat_links_data.temp) {
            this.chat_links_data.temp = [];
            return;
        }
        delete this.chat_links_data.temp[link_id];
        return await this.save();
    }
    async applyTempLink(link_id, link_date){
        if (!this.chat_links_data.temp) this.chat_links_data.temp = [];
        let link_data = this.chat_links_data.temp[+link_id];
        if (!link_data) throw new Error('Link Data not found');
        link_data.link_expire_date = now(link_date).endOf('day');
        if (!this.chat_links_data[link_data.link_lesson_hash]) this.chat_links_data[link_data.link_lesson_hash] = [];
        this.chat_links_data[link_data.link_lesson_hash].push(link_data);
        delete this.chat_links_data.temp[link_id]
        return await this.save();
    }
    async applyPermLink(link_id, link_date, link_title){
        if (!this.chat_links_data.temp) this.chat_links_data.temp = [];
        let link_data = this.chat_links_data.temp[+link_id];
        if (!link_data) throw new Error('Link Data not found');
        link_data.link_expire_date = now(link_date);
        link_data.link_title = link_title;
        if (!this.chat_links_data[link_data.link_lesson_hash]) this.chat_links_data[link_data.link_lesson_hash] = [];
        this.chat_links_data[link_data.link_lesson_hash].push(link_data);
        delete this.chat_links_data.temp[link_id]
        return await this.save();
    }
    async deleteLink(lesson_hash, link_index, messager){
        let links_data = this.getLinks(lesson_hash);
        if (!links_data) return;
        links_data.splice(+link_index, 1);
        await this.save();
        return await this.sendLinksDelete(lesson_hash, messager);
    }

    getLinks(lesson_hash, filter = false, parent = false){
        let result_array = this.chat_links_data[lesson_hash] || [];
        if (filter) result_array = result_array.filter(link => {
            return now(link.link_expire_date) > now()
        })
        if (!parent || !this.chat_links_parent_id) return result_array;
        let second_array = this.manager.get(this.chat_links_parent_id).getLinks(lesson_hash, filter, false);
        return result_array.concat(second_array);
    }
    setLinksParent(parent_id){
        this.chat_links_parent_id = parent_id || null;
        return this.save();
    }

    //---------------------------

    save(){
        return this.manager.save(this)
    }
}

module.exports = { ChatManager }