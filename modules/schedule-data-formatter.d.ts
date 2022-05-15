import { SendMessageOptions } from "node-telegram-bot-api/index"
import { Chat } from "./chat-data-manager"
import { AnyScheduleResult, CurrentScheduleResult, CurrentWeekScheduleResult, FirstWeekScheduleResult, Group, NextdayScheduleResult, NextScheduleResult, NextWeekScheduleResult, SecondWeekScheduleResult, TodayScheduleResult, TomorrowScheduleResult } from "./group-data-manager"

type ScheduleKeyGetter = "current" | "before" | "now" | "next" | "today" | "tomorrow" | "nextday" | "week_current" | "week_next"

declare function formatScheduleData(key: ScheduleKeyGetter, schedule_data: AnyScheduleResult, group_data: Group, chat_data: Chat):                  { text: string, options: SendMessageOptions }
declare function formatScheduleData(key: "current" | "before" | "now", schedule_data: CurrentScheduleResult, group_data: Group, chat_data: Chat):   { text: string, options: SendMessageOptions }
declare function formatScheduleData(key: "next", schedule_data: NextScheduleResult, group_data: Group, chat_data: Chat):                            { text: string, options: SendMessageOptions }
declare function formatScheduleData(key: "today", schedule_data: TodayScheduleResult, group_data: Group, chat_data: Chat):                          { text: string, options: SendMessageOptions }
declare function formatScheduleData(key: "tomorrow", schedule_data: TomorrowScheduleResult, group_data: Group, chat_data: Chat):                    { text: string, options: SendMessageOptions }
declare function formatScheduleData(key: "nextday", schedule_data: NextdayScheduleResult, group_data: Group, chat_data: Chat):                      { text: string, options: SendMessageOptions }
declare function formatScheduleData(key: "week_current", schedule_data: CurrentWeekScheduleResult, group_data: Group, chat_data: Chat):             { text: string, options: SendMessageOptions }
declare function formatScheduleData(key: "week_next", schedule_data: NextWeekScheduleResult, group_data: Group, chat_data: Chat):                   { text: string, options: SendMessageOptions }
declare function formatScheduleData(key: "week_first", schedule_data: FirstWeekScheduleResult, group_data: Group, chat_data: Chat):                 { text: string, options: SendMessageOptions }
declare function formatScheduleData(key: "week_second", schedule_data: SecondWeekScheduleResult, group_data: Group, chat_data: Chat):               { text: string, options: SendMessageOptions }
export as namespace ScheduleDataFormatter