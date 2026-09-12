// The timesheets domain moved to @oryh/ai-client-timesheets. Re-exported so existing imports work.
export type {
  OryhTimesheetRemote,
  TimesheetAction,
  TimesheetApproval,
  TimesheetDetail,
  TimesheetEntry,
  TimesheetFields,
  TimesheetHeader,
  TimesheetIntent,
  TimesheetLine,
  TimesheetOptions,
  TimesheetTodo,
} from '@oryh/ai-client-timesheets'
export { timesheetError, validateTimesheet } from '@oryh/ai-client-timesheets'
