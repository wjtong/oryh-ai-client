// The record query service moved to @oryh/ai-client-records, where it depends on narrow
// structural interfaces instead of this package. Re-exported so host.ts and existing
// imports keep working unchanged.
export { RecordService, decodeRecordPage } from '@oryh/ai-client-records'
export type { RecordConnection, RecordHttp } from '@oryh/ai-client-records'
