import { TelegramBot } from "node-telegram-bot-api"
import { Group } from "./group-data-manager"
import { Client } from 'pg'
import { Moment } from "moment-timezone"
import { MessageChain } from "./utils"

type ChatToggleKey = 'hide_teachers' | 'ignore_links' | 'before_notification' | 'now_notifications'

declare interface ChatLinkData {
    link_lesson_hash: string,
    link_title: string,
    link_url: string,
    link_type: string,
    link_expire_date: Moment
}

declare class ChatManager {
    bot: TelegramBot
    client: Client
    chats_data: {[chatId: string]: Chat}
    constructor(client: Client, bot: TelegramBot)

    get(): null
    get(chat_id: string | number): Chat

    isAdmin(chat_id: string | number, user_id: string | number): Promise<boolean>

    save(chat_data: Chat): Promise<void>

    getDataFromDatabase(): Promise<void>
}

declare class Chat {
    chat_id: number
    chat_is_user: boolean
    chat_group_name: string | null
    chat_hide_teachers: boolean
    chat_ignore_links: boolean
    chat_links_parent_id: number | null
    chat_before_notifications: boolean
    chat_now_notifications: boolean
    chat_links_data: {[lessonHash: string] : ChatLinkData[]}
    constructor(manager: ChatManager, chat_id: string | number)

    bind(user_id: string | number, group_data: Group, checked?: boolean): Promise<void>
    unbind(user_id: string | number, checked?: boolean): Promise<void>
    toggle(user_id: string | number, key: ChatToggleKey, value?: boolean): Promise<void>

    sendSettings(messager: MessageChain, user_id: string | number, query_id?: string | number, checked?: boolean): Promise<void>
    sendBind(messager: MessageChain, group_data: Group, user_id: string | number, query_id?: string | number, checked?: boolean): Promise<void>
    sendLinksDelete(lesson_hash: string, messager: MessageChain): Promise<void>

    isAdmin(user_id: string | number): Promise<boolean>

    getLinks(lesson_hash: string, filter?: boolean, parent?: boolean): ChatLinkData[]
    addTempLink(link_data: ChatLinkData): Promise<number>
    removeTempLink(link_id: string | number): Promise<void>
    applyTempLink(link_id: string | number, link_date: string | number): Promise<void>
    applyPermLink(link_id: string | number, link_date: string | number, link_title: string): Promise<void>
    deleteLink(lesson_hash: string, link_index: string, messager: MessageChain): Promise<void>
    setLinksParent(parent_id: string | number): Promise<void>

    save(): Promise<void>
}

export as namespace ChatManager

// CREATE TABLE chats_data (
// 	chat_id integer NOT NULL UNIQUE,
// 	chat_group_name varchar(16) DEFAULT NULL,
	
// 	chat_hide_teachers boolean DEFAULT false,
// 	chat_ignore_links boolean DEFAULT false,
// 	chat_links_parent_id integer DEFAULT NULL,
	
// 	chat_before_notifications boolean DEFAULT false,
// 	chat_now_notifications boolean DEFAULT false

//  chat_links_data JSONB
// )