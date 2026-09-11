import {ProjectTable,projectColumnLabels,defaultProjectColumns} from './project-columns.js';
import type {ProjectColumn} from '@oryh/dsh-host/types';
import type {OryhProject} from '@oryh/ai-client-core/types';
import { TodoChat } from './todo-chat.js';
import { useBusinessText } from './locale.js';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Badge, Button, Field, Input, MessageBar, MessageBarBody, Select, Spinner } from '@fluentui/react-components';
import { IconArrowLeft, IconArrowUpRight, IconSearch, IconRefresh, IconPlus, IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import type { ConnectionSummary, OperationId, OryhOperationResult, SavedOperationView } from '@oryh/ai-client-core';
import { useOryhRemote } from './remote.js';
import { businessRows, emptyFilter, filterRows, statusLabel, type ViewFilter } from './business-data.js';
import type { PageContext } from './workbench.js';
export function BusinessPage({ projectColumns=defaultProjectColumns,onProjectColumns,connection, operationId, active, onContext, onNewExpense, onNewProject }: {
    projectColumns?:ProjectColumn[];
    onProjectColumns?:(columns:ProjectColumn[])=>void;
    connection: ConnectionSummary;
    operationId: OperationId;
    active: boolean;
    onContext: (value: PageContext) => void;
    onNewExpense: (() => void) | undefined;
    onNewProject?:()=>void;
}): ReactNode {
    const t = useBusinessText();
    const remote = useOryhRemote();
    const [result, setResult] = useState<OryhOperationResult>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [filter, setFilter] = useState<ViewFilter>(emptyFilter);
    const [page, setPage] = useState(1);
    const [selectedId, setSelectedId] = useState<string>();
    const [todoNavigationId,setTodoNavigationId]=useState<string>();
    const [saved, setSaved] = useState<readonly SavedOperationView[]>([]);
    const [label, setLabel] = useState('');
    const [saveMessage, setSaveMessage] = useState('');
    const root = useRef<HTMLDivElement>(null);
    const listScroll = useRef(0);
    function openRecord(id: string, navigationId?:string) {
        setTodoNavigationId(navigationId);
        const main = root.current?.closest<HTMLElement>('.oryh-business-seat');
        listScroll.current = main?.scrollTop ?? 0;
        setSelectedId(id);
        requestAnimationFrame(() => { if (main)
            main.scrollTop = 0; root.current?.querySelector<HTMLButtonElement>('.business-page-header button')?.focus(); });
    }
    function returnToList() {
        setSelectedId(undefined);
        requestAnimationFrame(() => { const main = root.current?.closest<HTMLElement>('.oryh-business-seat'); if (main)
            main.scrollTop = listScroll.current; const target = root.current?.querySelector<HTMLButtonElement>(`button[data-row-id="${CSS.escape(selectedId ?? '')}"]`); target?.focus({ preventScroll: true }); });
    }
    const loaded = useRef(false);
    const alive = useRef(true);
    const running = useRef(false);
    const contextCallback = useRef(onContext);
    contextCallback.current = onContext;
    const rows = useMemo(() => result ? businessRows(result, t) : [], [result, t]);
    const filtered = useMemo(() => filterRows(rows, filter), [rows, filter]);
    const selected = rows.find(row => row.id === selectedId);
    const pages = Math.max(1, Math.ceil(filtered.length / 12));
    const currentPage = Math.min(page, pages);
    const title = operationId === 'list-projects' ? t("text26") : operationId === 'my-expense-claims' ? t("text27") : t("text8");
    const dateLabel = operationId === 'list-projects' ? t("text28") : operationId === 'my-expense-claims' ? t("text29") : t("text30");
    const invalidDates = Boolean(filter.from && filter.to && filter.from > filter.to);
    const conditions = [filter.text && t("text31", { value0: filter.text }), filter.status && t("text32", { value0: statusLabel(filter.status, t) }), filter.from && t("text33", { value0: dateLabel, value1: filter.from }), filter.to && t("text34", { value0: filter.to })].filter(Boolean).join(' · ');
    const total = result?.result.meta.total;
    const scope = t("text37", { value0: rows.length, value1: total !== null && total !== undefined ? t("text35", { value0: total }) : t("text36") });
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    useEffect(() => { if (active && !loaded.current) {
        loaded.current = true;
        void load();
    } }, [active]);
    useEffect(() => {
        contextCallback.current({ key: `${operationId}:${selected?.id ?? 'list'}`, title: selected?.title ?? title,
            detail: selected ? t("text38") : conditions || t("text39"), scope: result ? `${scope}${error ? t("text40") : ''}` : t("text41"), ...(operationId==='list-projects'?{columns:projectColumns}:{}), content: JSON.stringify({loading:busy,error,filter,page:currentPage,pages,selected:selected??null,visibleRows:busy||invalidDates?[]:filtered.slice((currentPage-1)*12,currentPage*12)}) });
    }, [selected?.id, selected?.title, title, conditions, scope, operationId, result, error, busy, filter, currentPage, pages, filtered, projectColumns]);
    async function load(savedId?: SavedOperationView['id']) {
        if (running.current)
            return;
        running.current = true;
        setBusy(true);
        setError('');
        try {
            const next = savedId ? await remote.refreshSavedOperation(connection.id, savedId) : await remote.execute(connection.id, operationId);
            if (!alive.current)
                return;
            if (next.operationId !== operationId || next.connectionId !== connection.id)
                throw new Error(t("text42"));
            setResult(next);
            try {
                const entries = await remote.listSavedOperations(connection.id);
                if (alive.current)
                    setSaved(entries.filter(entry => entry.operationId === operationId));
            }
            catch {
                if (alive.current)
                    setSaveMessage(t("text43"));
            }
        }
        catch (reason) {
            if (alive.current)
                setError(reason instanceof Error ? reason.message : t("text44"));
        }
        finally {
            running.current = false;
            if (alive.current)
                setBusy(false);
        }
    }
    function update(patch: Partial<ViewFilter>) { setFilter(current => ({ ...current, ...patch })); setPage(1); }
    async function save() {
        if (!result || running.current || !label.trim())
            return;
        running.current = true;
        setBusy(true);
        setSaveMessage('');
        try {
            const value = await remote.saveResult(connection.id, operationId, result.id, label.trim());
            if (alive.current) {
                setSaved(current => [...current, value]);
                setLabel('');
                setSaveMessage(t("text45"));
            }
        }
        catch (reason) {
            if (alive.current)
                setSaveMessage(reason instanceof Error ? reason.message : t("text46"));
        }
        finally {
            running.current = false;
            if (alive.current)
                setBusy(false);
        }
    }
    return <div ref={root} className="business-page">
    <header className="business-page-header">
      {selected ? <><Button appearance="subtle" icon={<IconArrowLeft size={17}/>} onClick={returnToList}>{t("text49")}</Button><div className="record-heading"><h1>{selected.title}</h1><Badge appearance="tint">{statusLabel(selected.status, t)}</Badge></div></> : <div className="list-actions"><div><h1>{title}</h1><span className="muted">{result ? t("text54", { value0: rows.length }) : t("text55")}</span></div><div className="toolbar"><Button disabled={busy} icon={<IconRefresh size={17}/>} onClick={() => void load()}>{t("text56")}</Button>{onNewProject&&<Button appearance="primary" onClick={onNewProject}>新建项目</Button>}{onNewExpense && <Button appearance="primary" icon={<IconPlus size={17}/>} onClick={onNewExpense}>{t("text57")}</Button>}</div></div>}
    </header>
    {error && <MessageBar intent="error"><MessageBarBody>{error} {result && t("text47")}</MessageBarBody><Button disabled={busy} onClick={() => void load()}>{t("text48")}</Button></MessageBar>}
    {active && operationId === 'my-open-todos' && <TodoChat connectionId={connection.id} visibleTodos={busy||invalidDates?[]:filtered.slice((currentPage-1)*12,currentPage*12).map(r=>({id:r.id,title:r.title}))} listContext={JSON.stringify({currentPage,filter,busy})} onOpen={openRecord} {...(todoNavigationId?{navigationId:todoNavigationId}:{})} {...(selected?.id ? { todoId: selected.id } : {})}/>}
    {selected ? <section className="surface record-detail">{operationId === 'my-open-todos' ? <details><summary>待办摘要与原系统入口</summary><dl className="detail-grid"><dt>{t("text50")}</dt><dd>{selected.id}</dd>{selected.fields.map(([name, value]) => <div className="detail-pair" key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl><Button as="a" href={`${connection.origin}/console/objects/${selected.entityType}/${encodeURIComponent(selected.id)}`} target="_blank" rel="noreferrer" icon={<IconArrowUpRight size={17}/>}>{t("text52")}</Button></details> : <><dl className="detail-grid"><dt>{t("text50")}</dt><dd>{selected.id}</dd>{selected.fields.map(([name, value]) => <div className="detail-pair" key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl><p className="muted">{t("text51")}</p><Button as="a" href={`${connection.origin}/console/objects/${selected.entityType}/${encodeURIComponent(selected.id)}`} target="_blank" rel="noreferrer" icon={<IconArrowUpRight size={17}/>}>{t("text52")}</Button></>}</section>
            : <>
      {selectedId && !selected && <MessageBar><MessageBarBody>{t("text53")}</MessageBarBody></MessageBar>}
      <section className="surface table-surface" aria-label={title}>
        <div className="query-toolbar"><Field label={t("text58")}><Input contentBefore={<IconSearch size={16}/>} placeholder={t("text59")} value={filter.text} onChange={(_, data) => update({ text: data.value })}/></Field>
          <Field label={t("text60")}><Select value={filter.status} onChange={event => update({ status: event.target.value })}><option value="">{t("text61")}</option>{[...new Set([...rows.map(row => row.status), ...(filter.status ? [filter.status] : [])])].map(status => <option key={status} value={status}>{statusLabel(status, t)}</option>)}</Select></Field>
        </div><details className="advanced-filters"><summary>更多筛选与排序{(filter.from || filter.to || !filter.descending) ? " · 已设置" : ""}</summary><div className="advanced-filter-fields">
          <Field label={t("text62", { value0: dateLabel })}><Input type="date" value={filter.from} onChange={(_, data) => update({ from: data.value })}/></Field>
          <Field label={t("text63")}><Input type="date" value={filter.to} onChange={(_, data) => update({ to: data.value })}/></Field>
          <Field label={t("text64")}><Select value={filter.descending ? 'desc' : 'asc'} onChange={event => update({ descending: event.target.value === 'desc' })}><option value="desc">{t("text65")}</option><option value="asc">{t("text66")}</option></Select></Field>
        </div></details>
        {operationId==='list-projects'&&onProjectColumns&&<details className="advanced-filters"><summary>显示列</summary><div className="project-column-options">{(Object.keys(projectColumnLabels) as ProjectColumn[]).map(c=><label key={c}><input type="checkbox" checked={projectColumns.includes(c)} disabled={c==='name'} onChange={e=>onProjectColumns(e.target.checked?[...projectColumns,c]:projectColumns.filter(k=>k!==c))}/>{projectColumnLabels[c]}</label>)}<Button appearance="subtle" size="small" onClick={()=>onProjectColumns([...defaultProjectColumns])}>恢复默认列</Button></div></details>}
        {conditions && <div className="filter-summary"><span>{conditions || t("text67")}</span>{conditions && <Button appearance="subtle" size="small" onClick={() => { setFilter(emptyFilter); setPage(1); }}>{t("text68")}</Button>}</div>}
        {invalidDates && <MessageBar intent="error"><MessageBarBody>{t("text69")}</MessageBarBody></MessageBar>}
        {busy && <div className="list-loading" role="status"><Spinner size="tiny"/>{t("text70")}</div>}
        {!result && !busy ? <div className="empty-state"><h3>{t("text71")}</h3><p>{t("text72")}</p></div> : result && <>
          {operationId==='list-projects'?<ProjectTable columns={projectColumns} projects={invalidDates?[]:filtered.slice((currentPage-1)*12,currentPage*12).map(row=>(result.result.data as OryhProject[]).find(p=>p.id===row.id)!)} onOpen={openRecord}/>:<div className="table-scroll"><table><caption className="sr-only">{title}{t("text73")}</caption><thead><tr><th scope="col">{t("text75")}</th><th scope="col">{t("text60")}</th><th scope="col">{operationId === 'my-expense-claims' ? t("text77") : t("text78")}</th><th scope="col">{dateLabel}</th><th scope="col"><span className="sr-only">{t("text79")}</span></th></tr></thead><tbody>{!invalidDates && filtered.slice((currentPage - 1) * 12, currentPage * 12).map(row => <tr key={row.id}><td><button className="record-link" data-row-id={row.id} onClick={event => openRecord(row.id)}>{row.title}</button></td><td><span className={`record-status status-${row.status === 'open' || row.status === 'submitted' ? 'pending' : 'neutral'}`}>{statusLabel(row.status, t)}</span></td><td>{row.secondary || '—'}</td><td className="numeric">{row.date || '—'}</td><td><Button appearance="subtle" size="small" aria-label={t("text80", { value0: row.title })} icon={<IconChevronRight size={16}/>} onClick={event => openRecord(row.id)}/></td></tr>)}</tbody></table></div>}
          {(filtered.length === 0 || invalidDates) && <div className="empty-state"><h3>{conditions ? t("text81") : t("text82")}</h3><p>{conditions ? t("text83") : t("text84")}</p></div>}
          <footer className="table-footer"><span>{t("text85")}{invalidDates ? 0 : filtered.length}{t("text86")}</span><div className="pagination"><Button size="small" aria-label={t("text87")} disabled={currentPage <= 1} icon={<IconChevronLeft size={16}/>} onClick={() => setPage(currentPage - 1)}/><span>{currentPage} / {pages}</span><Button size="small" aria-label={t("text88")} disabled={currentPage >= pages} icon={<IconChevronRight size={16}/>} onClick={() => setPage(currentPage + 1)}/></div></footer>
        </>}
      </section>
      <div className="data-caption"><span>{scope}</span>{result && <time dateTime={result.executedAt}>{t("text89")}{new Date(result.executedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time>}</div>
      <details className="saved-queries"><summary>{t("text90")}{saved.length ? ` · ${saved.length}` : ''}</summary><p>{t("text91")}</p><div className="toolbar"><Input aria-label={t("text92")} placeholder={t("text93")} value={label} onChange={(_, data) => setLabel(data.value)}/><Button disabled={busy || !result || !label.trim()} onClick={() => void save()}>{t("text94")}</Button></div>{saveMessage && <p role="status">{saveMessage}</p>}{saved.map(entry => <div className="saved-entry" key={entry.id}><span>{entry.label}</span><Button size="small" disabled={busy} onClick={() => { setFilter(emptyFilter); setPage(1); void load(entry.id); }}>{t("text95")}</Button></div>)}</details>
    </>}
  </div>;
}
