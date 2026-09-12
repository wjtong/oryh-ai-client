// The timesheet service moved to @oryh/ai-client-timesheets, where it depends on narrow
// structural interfaces instead of this package. Re-exported so host.ts and existing
// imports keep working unchanged.
export { TimesheetService } from '@oryh/ai-client-timesheets'
export type { TimesheetConnection, TimesheetHttp } from '@oryh/ai-client-timesheets'
