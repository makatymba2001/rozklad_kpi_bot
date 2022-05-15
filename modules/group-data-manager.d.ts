import { Client } from 'pg'
import { Moment, MomentInput } from 'moment-timezone'
import TelegramBot from 'node-telegram-bot-api'
import { ScheduleKeyGetter } from './schedule-data-formatter'
import { MessageChain } from './utils'

type Falsy = 0 | false | "" | null | void
declare type WeekendsDataItem = {from: Moment, to: Moment, text: string}
declare type ShuffleDataItem = {day: number, change_week_number: boolean}
declare type ListArray = [List, ...Group[]]

//--------------------------------

declare type LessonRoom = {
    room_name: string,
    room_latitude: string,
    room_longitude: string
}
declare type LessonTeacher = {
    teacher_name: string,
    teacher_link: string
}
declare interface ScheduleLesson {
    lesson_hash: string,
    lesson_name: string,
    lesson_type: string | null,
    lesson_rooms: Array<LessonRoom>,
    lesson_teachers: Array<LessonTeacher>
}
declare interface ScheduleDay extends Array<ScheduleLesson | undefined>{
    count: Number, min: Number, max: Number
}
declare interface ScheduleEmptyDay extends []{
    count: 0, min: 0, max: 0
}
declare type ScheduleWeek = Array<ScheduleDay> | []
declare type Schedule = ScheduleWeek

//--------------------------------

declare interface DateParams {
    now_date: Moment,
    query_date: Moment,
    
    day_weekend: string | null,
    day_is_shuffled: boolean,

    day_index: number,
    day_semester: number,
    day_week: number,
    day_weekday: number,

    lesson_number: number
    lesson_is_brake: boolean,
    lesson_date: Moment
}
declare interface NextValidDateParams extends DateParams{
    is_valid: true
}
declare interface NextInvalidDateParams {
    is_valid: false,
    now_date: Moment,
    query_date: Moment
}
declare type NextDateParams = NextInvalidDateParams | NextValidDateParams

//--------------------------------

declare interface ScheduleResult {
    is_contain_schedule: false,
    current_params: DateParams,
}


declare interface CurrentInvalidScheduleResult extends ScheduleResult{
    current_lesson: null
}
declare interface CurrentValidScheduleResult extends CurrentInvalidScheduleResult {
    is_contain_schedule: true,
    current_lesson: ScheduleLesson | null
}
declare type CurrentScheduleResult = CurrentInvalidScheduleResult | CurrentValidScheduleResult


declare interface NextInvalidScheduleResult extends ScheduleResult{
    next_params: NextInvalidDateParams
    next_lesson: null
}
declare interface NextValidScheduleResult extends NextInvalidScheduleResult {
    is_contain_schedule: true,
    next_params: NextDateParams
    next_lesson: ScheduleLesson | null
}
declare type NextScheduleResult = NextInvalidScheduleResult | NextValidScheduleResult


declare interface TodayInvalidScheduleResult extends ScheduleResult{
    today_lessons: ScheduleEmptyDay
}
declare interface TodayValidScheduleResult extends TodayInvalidScheduleResult {
    is_contain_schedule: true,
    today_lessons: ScheduleDay
}
declare type TodayScheduleResult = TodayInvalidScheduleResult | TodayValidScheduleResult


declare interface TomorrowInvalidScheduleResult extends ScheduleResult{
    tomorrow_params: DateParams,
    tomorrow_lessons: ScheduleEmptyDay
}
declare interface TomorrowValidScheduleResult extends TomorrowInvalidScheduleResult {
    is_contain_schedule: true,
    tomorrow_lessons: ScheduleDay
}
declare type TomorrowScheduleResult = TomorrowInvalidScheduleResult | TomorrowValidScheduleResult


declare interface NextdayInvalidScheduleResult extends ScheduleResult{
    nextday_params: NextInvalidDateParams,
    nextday_lessons: ScheduleEmptyDay
}
declare interface NextdayValidScheduleResult extends NextdayInvalidScheduleResult {
    is_contain_schedule: true,
    nextday_params: NextDateParams,
    nextday_lessons: ScheduleDay
}
declare type NextdayScheduleResult = NextdayInvalidScheduleResult | NextdayValidScheduleResult


declare interface CurrentWeekInvalidScheduleResult extends ScheduleResult{
    current_week_lessons: []
}
declare interface CurrentWeekValidScheduleResult extends CurrentWeekInvalidScheduleResult {
    is_contain_schedule: true,
    current_week_lessons: ScheduleWeek
}
declare type CurrentWeekScheduleResult = CurrentWeekInvalidScheduleResult | CurrentWeekValidScheduleResult


declare interface NextWeekInvalidScheduleResult extends ScheduleResult{
    next_week_params: DateParams,
    next_week_lessons: [],
}
declare interface NextWeekValidScheduleResult extends NextWeekInvalidScheduleResult {
    is_contain_schedule: true,
    next_week_lessons: ScheduleWeek
}
declare type NextWeekScheduleResult = NextWeekInvalidScheduleResult | NextWeekValidScheduleResult

declare interface FirstWeekInvalidScheduleResult extends ScheduleResult{
    first_week_lessons: [],
}
declare interface FirstWeekValidScheduleResult extends FirstWeekInvalidScheduleResult {
    is_contain_schedule: true,
    first_week_lessons: ScheduleWeek
}
declare type FirstWeekScheduleResult = FirstWeekInvalidScheduleResult | FirstWeekValidScheduleResult

declare interface SecondWeekInvalidScheduleResult extends ScheduleResult{
    second_week_lessons: [],
}
declare interface SecondWeekValidScheduleResult extends SecondWeekInvalidScheduleResult {
    is_contain_schedule: true,
    second_week_lessons: ScheduleWeek
}
declare type SecondWeekScheduleResult = SecondWeekInvalidScheduleResult | SecondWeekValidScheduleResult

declare type NotifSearchCallback = (group_data: Group) => Promise<void>

declare interface NotifSearchDataOptions {
    group_name: string,
    group_variant_number: number,
    edit_message: boolean,
    onListFound: NotifSearchCallback,
    onGroupFound: NotifSearchCallback
}
declare interface NotifSearchScheduleDataOptions {
    group_name: string,
    group_variant_number: number,
    edit_message: boolean,
    onListFound: NotifSearchCallback,
    onScheduleFound: NotifSearchCallback
}
declare interface NotifSearchScheduleOptions {
    group_name: string,
    group_variant_number: number,
    edit_message: boolean,
    hide_teachers?: boolean
}
declare interface NotifSearchScheduleResult {
    is_list?: boolean,
    messager: MessageChain,
    group_data: Group,
    schedule_data: AnyScheduleResult | null,
}
declare interface SearchScheduleResult {
    is_list?: boolean,
    group_data: Group,
    schedule_data: AnyScheduleResult | null,
}

declare type AllInvalidScheduleResult = CurrentInvalidScheduleResult & NextInvalidScheduleResult & TodayInvalidScheduleResult
& TomorrowInvalidScheduleResult & NextdayInvalidScheduleResult & CurrentWeekInvalidScheduleResult & NextWeekInvalidScheduleResult
& FirstWeekInvalidScheduleResult & SecondWeekInvalidScheduleResult
declare type AllValidScheduleResult = CurrentValidScheduleResult & NextValidScheduleResult & TodayValidScheduleResult
& TomorrowValidScheduleResult & NextdayValidScheduleResult & CurrentWeekValidScheduleResult & NextWeekValidScheduleResult
& FirstWeekValidScheduleResult & SecondWeekValidScheduleResult
declare type AllScheduleResult = AllInvalidScheduleResult | AllValidScheduleResult

declare type AnyScheduleResult = CurrentValidScheduleResult | NextValidScheduleResult | TodayValidScheduleResult
| TomorrowValidScheduleResult | NextdayValidScheduleResult | CurrentWeekValidScheduleResult | NextWeekValidScheduleResult
| FirstWeekScheduleResult | SecondWeekScheduleResult

//--------------------------------

class GroupBase{
    manager: GroupManager
    group_name: string
    group_variant_number: number
    group_parent_name: null
    group_schedule: []
    is_fetched_schedule: false
    constructor(manager: GroupManager, group_name: string, group_variant_number?: number)

    isEmpty(): false
    isList(): false
    isGroup(): false

    getList(): []
    getVariant(variant_number?: number): null

    search(): Promise<Group | List>
    fetch(): Promise<void>

    getCurrentParams(input?: MomentInput): DateParams
    getTomorrowParams(input?: MomentInput): DateParams
    getNextParams(input?: MomentInput): NextInvalidDateParams

    getSemesterNumber(invert?: boolean, date?: MomentInput): 1 | 2
    getWeekNumber(invert?: boolean, date?: MomentInput): 1 | 2

    getCurrentLesson(input?: MomentInput): CurrentInvalidScheduleResult
    getNextLesson(input?: MomentInput): NextInvalidScheduleResult

    getTodayLessons(input?: MomentInput): TodayInvalidScheduleResult
    getTomorrowLessons(input?: MomentInput): TomorrowInvalidScheduleResult
    getNextDayLessons(input?: MomentInput): NextdayInvalidScheduleResult

    getCurrentWeekLessons(input?: MomentInput): CurrentWeekInvalidScheduleResult
    getNextWeekLessons(input?: MomentInput): NextWeekInvalidScheduleResult

    getFirstWeekLessons(input?: MomentInput): FirstWeekInvalidScheduleResult
    getSecondWeekLessons(input?: MomentInput): SecondWeekInvalidScheduleResult
    
    getAllLessonsData(input?: MomentInput): AllInvalidScheduleResult
    getFullSchedule(input?: MomentInput): []
}
declare class Group extends GroupBase{
    group_schedule: Schedule
    group_id: string
    group_viewstate: string
    group_parent_name: string
    is_fetched_schedule: boolean
    constructor(manager: GroupManager, group_name: string, group_variant_number?: number, group_id?: string, group_parent_name?: string)

    isGroup(): true

    getNextParams(input?: MomentInput): NextDateParams

    getCurrentLesson(input?: MomentInput): CurrentScheduleResult
    getNextLesson(input?: MomentInput): NextScheduleResult

    getTodayLessons(input?: MomentInput): TodayScheduleResult
    getTomorrowLessons(input?: MomentInput): TomorrowScheduleResult
    getNextDayLessons(input?: MomentInput): NextdayScheduleResult

    getCurrentWeekLessons(input?: MomentInput): CurrentWeekScheduleResult
    getNextWeekLessons(input?: MomentInput): NextWeekScheduleResult
    
    getFirstWeekLessons(input?: MomentInput): FirstWeekScheduleResult
    getSecondWeekLessons(input?: MomentInput): SecondWeekScheduleResult

    getAllLessonsData(input?: MomentInput): AllScheduleResult
    getFullSchedule(input?: MomentInput): Schedule

    updateSchedule(quick: boolean): Promise<Group>
}
declare class List extends GroupBase{
    group_ids_list: string[]
    constructor(manager: GroupManager, group_name: string)

    isList(): true;

    getVariant(variant_number?: number): Group | null;
    getList(): ListArray
}
declare class EmptyGroup extends GroupBase{
    group_parent_name: string
    constructor(manager: GroupManager, group_name: string, group_variant_number?: number)

    isEmpty(): true
}

declare class GroupManager{
    client: Client
    bot: TelegramBot

    separator: string
    teachers_data: {[shortTeacherName: string]: string}
    weekends_days: {[dayOfYear: string]: string}
    weekends_ranges: Array<WeekendsDataItem>
    shuffled_days: {[month: number]: {[day: number]: ShuffleDataItem}}

    groups_storage: {[groupId: string]: Group}
    lists_storage: {[groupName: string]: List}
    temp_storage:  {[groupName: string]: EmptyGroup}
    group_storage: {[groupId: string]: Group}

    constructor(client: Client, bot: TelegramBot)
    
    get(): null
    get(group_name: string, variant_number?: number): Group | List | EmptyGroup
    getOrSearch(group_name: string, variant_number?: number, onGroupSearchStart?: Function): Promise<Group | List>
    getOrSearchWithSchedule(group_name: string, variant_number?: number, onGroupSearchStart?: Function, onScheduleUpdateStart?: Function): Promise<Group | List>

    getGroupDataWithNotif(msg: TelegramBot.Message, options: NotifSearchDataOptions): Promise<void>
    getGroupDataWithScheduleAndNotif(msg: TelegramBot.Message, options: NotifSearchScheduleDataOptions): Promise<void>
    getGroupSchedule(key: ScheduleKeyGetter, group_name: string, variant_number?: number): Promise<SearchScheduleResult>
    getGroupScheduleWithNotif(key: ScheduleKeyGetter, msg: TelegramBot.Message, options: NotifSearchScheduleOptions): Promise<NotifSearchScheduleResult>

    save<T extends Group | List>(group_data: T): Promise<T>

    getDataFromDatabase(): Promise<void>

    getCurrentParams(input?: MomentInput): DateParams
    getTomorrowParams(input?: MomentInput): DateParams

    getSemesterNumber(invert?: boolean, date?: MomentInput): 1 | 2
    getWeekNumber(invert?: boolean, date?: MomentInput): 1 | 2

    getWeekendsData(date?: MomentInput): string | null
    getShuffleData(date?: MomentInput): ShuffleDataItem | null

    loadWeekendsData(json: Object): void
    loadShuffleData(json: Object): void
    loadTeachersData(json: Object): void
}

export as namespace GroupDataManager