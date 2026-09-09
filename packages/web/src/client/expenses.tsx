import { useBusinessText } from './locale.js';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Badge, Button, Card, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, Link, MessageBar, MessageBarBody, Select, Spinner, Text, Textarea, Title2 } from '@fluentui/react-components';
import type { ConnectionSummary, ExpenseDraft, ExpenseFields, ExpenseLine, ExpenseState } from '@oryh/ai-client-core';
import { useOryhRemote } from './remote.js';
import type { PageContext } from './workbench.js';
function today(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function newLine(category: string): ExpenseLine { return { expenseDate: today(), category, amount: '', merchant: '', invoiceNumber: '', notes: '' }; }
function blank(category: string): ExpenseFields { return { title: '', claimDate: today(), currency: 'CNY', items: [newLine(category)] }; }
function total(fields: ExpenseFields): string {
    const cents = fields.items.reduce((sum, row) => sum + Math.round((Number(row.amount) || 0) * 100), 0);
    return (cents / 100).toFixed(2);
}
/** Traditional expense editing and explicit confirmations; no model or automatic business writes. */
export function ExpensePanel({ connection, onDirtyChange, onContext, newRequest = 0 }: {
    connection: ConnectionSummary;
    onDirtyChange: (dirty: boolean) => void;
    onContext?: (value: PageContext) => void;
    newRequest?: number;
}): ReactNode {
    const t = useBusinessText();
    const names: Record<ExpenseState, string> = {
        editing: t("text22"), 'review-create': t("text96"), creating: t("text97"), created: t("text98"),
        'review-submit': t("text99"), submitting: t("text100"), submitted: t("text101"), 'unknown-create': t("text102"), 'unknown-submit': t("text103"),
    };
    const remote = useOryhRemote();
    const alive = useRef(true);
    const running = useRef(false);
    const dirtyRef = useRef(false);
    const [drafts, setDrafts] = useState<ExpenseDraft[]>([]);
    const [selected, setSelected] = useState<ExpenseDraft>();
    const [fields, setFields] = useState<ExpenseFields>(blank(''));
    const [categories, setCategories] = useState<{
        name: string;
        title: string;
    }[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string>();
    const [dirty, setDirty] = useState(false);
    const [dialog, setDialog] = useState(false);
    const [editor, setEditor] = useState(false);
    const [leaveAction, setLeaveAction] = useState<(() => void) | undefined>();
    const [draftSession, setDraftSession] = useState(0);
    const contextCallback = useRef(onContext);
    contextCallback.current = onContext;
    const lastNewRequest = useRef(0);
    const editable = selected === undefined || selected.state === 'editing' || selected.state === 'review-create';
    useEffect(() => {
        alive.current = true;
        void run(async () => {
            const [rows, options] = await Promise.all([remote.expenseList(connection.id), remote.expenseOptions(connection.id)]);
            if (alive.current) {
                setDrafts(rows);
                setCategories(options.categories);
            }
        });
        return () => { alive.current = false; onDirtyChange(false); };
    }, [connection.id]);
    useEffect(() => {
        const listener = (event: BeforeUnloadEvent) => { if (dirty || running.current) {
            event.preventDefault();
            event.returnValue = '';
        } };
        window.addEventListener('beforeunload', listener);
        return () => window.removeEventListener('beforeunload', listener);
    }, [dirty]);
    useEffect(() => {
        contextCallback.current?.({ key: editor ? `expense:${selected?.id ?? `new-${draftSession}`}` : 'expense-drafts', title: editor ? fields.title || t("text57") : t("text104"), detail: editor ? `${selected ? names[selected.state] : t("text105")}${dirty ? t("text106") : ''}` : t("text107"), scope: editor ? t("text108", { value0: fields.items.length }) : t("text109") });
    }, [editor, selected?.id, selected?.state, fields.title, fields.items.length, dirty, draftSession]);
    useEffect(() => {
        if (newRequest > lastNewRequest.current && !busy) {
            lastNewRequest.current = newRequest;
            choose();
        }
    }, [newRequest, busy]);
    function leave(action: () => void) { if (dirty)
        setLeaveAction(() => action);
    else
        action(); }
    async function run(action: () => Promise<void>): Promise<void> {
        if (running.current)
            return;
        running.current = true;
        setBusy(true);
        setError(undefined);
        onDirtyChange(true);
        try {
            await action();
        }
        catch (reason) {
            if (alive.current)
                setError(reason instanceof Error ? reason.message : t("text110"));
        }
        finally {
            running.current = false;
            if (alive.current) {
                setBusy(false);
                onDirtyChange(dirtyRef.current);
            }
        }
    }
    function changed(value: ExpenseFields) { setFields(value); setDirty(true); dirtyRef.current = true; onDirtyChange(true); setDialog(false); }
    function accept(value: ExpenseDraft) {
        if (!alive.current)
            return;
        setSelected(value);
        setFields(value.fields);
        setDirty(false);
        dirtyRef.current = false;
        onDirtyChange(false);
        setDrafts(rows => [value, ...rows.filter(row => row.id !== value.id)]);
    }
    function choose(value?: ExpenseDraft) {
        leave(() => {
            setDraftSession(current => current + 1);
            setSelected(value);
            setFields(value?.fields ?? blank(categories[0]?.name ?? ''));
            setDirty(false);
            dirtyRef.current = false;
            onDirtyChange(false);
            setEditor(true);
            setDialog(false);
            setError(undefined);
        });
    }
    function patchLine(index: number, changes: Partial<ExpenseLine>) {
        changed({ ...fields, items: fields.items.map((line, i) => i === index ? { ...line, ...changes } : line) });
    }
    async function upload(file: File, index: number) {
        if (file.size > 500 * 1024)
            throw new Error(t("text111"));
        const encoded = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
            reader.onerror = () => reject(new Error(t("text112")));
            reader.readAsDataURL(file);
        });
        const attachment = await remote.expenseUpload(connection.id, { filename: file.name, contentType: file.type, contentBase64: encoded });
        if (alive.current)
            patchLine(index, { attachment });
    }
    const panel = useRef<HTMLElement>(null);
    const listPosition = useRef(0);
    useEffect(() => {
        const seat = panel.current?.closest<HTMLElement>('.oryh-business-seat');
        if (!seat) return;
        if (editor) { listPosition.current = seat.scrollTop; seat.scrollTop = 0; }
        else seat.scrollTop = listPosition.current;
    }, [editor]);
    return <section ref={panel} className="expense-panel">
    <div className="list-actions business-page-header">
      <div><h2>{editor ? t("text113") : t("text22")}</h2><span className="muted">{editor ? t("text114") : t("text115")}</span></div>
      <div className="toolbar">
        {editor && <Button disabled={busy} onClick={() => leave(() => { setEditor(false); setDirty(false); dirtyRef.current = false; onDirtyChange(false); })}>{t("text116")}</Button>}
        {!editor && <Button appearance="primary" disabled={busy} onClick={() => choose()}>{t("text57")}</Button>}
        <Button disabled={busy || dirty} onClick={() => {
            void run(async () => {
                const rows = await remote.expenseList(connection.id);
                if (!alive.current)
                    return;
                setDrafts(rows);
                const current = rows.find(row => row.id === selected?.id);
                if (current)
                    accept(current);
            });
        }}>{t("text117")}</Button>
      </div>
    </div>
    {busy && <Spinner size="tiny" label={t("text118")}/>}
    {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
    {!editor && <div className="surface table-surface"><div className="table-scroll"><table><thead><tr><th scope="col">{t("text119")}</th><th scope="col">{t("text60")}</th><th scope="col">{t("text120")}</th><th scope="col">{t("text121")}</th></tr></thead><tbody>{drafts.map(row => <tr key={row.id}><td><button className="record-link" disabled={busy} onClick={() => choose(row)}>{row.fields.title || t("text122")}</button></td><td><Badge appearance="tint">{names[row.state]}</Badge></td><td className="numeric">{row.fields.currency} {total(row.fields)}</td><td>{new Date(row.updatedAt).toLocaleDateString('zh-CN')}</td></tr>)}</tbody></table></div>{drafts.length === 0 && !busy && <div className="empty-state"><h3>{t("text123")}</h3><p>{t("text124")}</p><Button appearance="primary" onClick={() => choose()}>{t("text125")}</Button></div>}</div>}
    {editor && <div className="surface expense-editor">
      <div><Badge>{selected ? names[selected.state] : t("text105")}</Badge> {dirty && <Text>{t("text126")}</Text>}</div>
      {selected?.message && <MessageBar><MessageBarBody>{selected.message}</MessageBarBody></MessageBar>}
      <h3 className="form-section-title">{t("text127")}</h3>
      <fieldset disabled={busy || !editable} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 12 }}>
        <Field label={t("text119")} required><Input value={fields.title} maxLength={200} onChange={(_, data) => changed({ ...fields, title: data.value })}/></Field>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Field label={t("text29")} required><Input type="date" value={fields.claimDate} onChange={(_, data) => changed({ ...fields, claimDate: data.value })}/></Field>
          <Field label={t("text77")} required><Input value={fields.currency} maxLength={3} onChange={(_, data) => changed({ ...fields, currency: data.value.toUpperCase() })}/></Field>
        </div>
        {fields.items.map((line, index) => <section key={index} className="expense-line" aria-label={t("text128", { value0: index + 1 })}>
          <Text weight="semibold">{t("text129")}{index + 1}</Text>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
            <Field label={t("text130")} required><Input type="date" value={line.expenseDate} onChange={(_, data) => patchLine(index, { expenseDate: data.value })}/></Field>
            <Field label={t("text131")} required><Select value={line.category} onChange={event => patchLine(index, { category: event.target.value })}>
              <option value="">{t("text132")}</option>{line.category && !categories.some(value => value.name === line.category) && <option value={line.category}>{line.category}{t("text133")}</option>}{categories.map(category => <option key={category.name} value={category.name}>{category.title}</option>)}
            </Select></Field>
            <Field label={t("text120")} required><Input inputMode="decimal" value={line.amount} onChange={(_, data) => patchLine(index, { amount: data.value })}/></Field>
            <Field label={t("text134")}><Input value={line.merchant} maxLength={200} onChange={(_, data) => patchLine(index, { merchant: data.value })}/></Field>
            <Field label={t("text135")}><Input value={line.invoiceNumber} maxLength={100} onChange={(_, data) => patchLine(index, { invoiceNumber: data.value })}/></Field>
          </div>
          <Field label={t("text136")}><Textarea value={line.notes} maxLength={2000} onChange={(_, data) => patchLine(index, { notes: data.value })}/></Field>
          <Field label={t("text137")}>
            <input aria-label={t("text138", { value0: index + 1 })} type="file" accept="application/pdf,image/png,image/jpeg" onChange={event => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file)
                        void run(() => upload(file, index));
                }}/>
          </Field>
          {line.attachment && <Text>{t("text139")}{line.attachment.filename}</Text>}
          <Button disabled={fields.items.length <= 1} onClick={() => changed({ ...fields, items: fields.items.filter((_, i) => i !== index) })}>{t("text140")}</Button>
        </section>)}
        <Button disabled={fields.items.length >= 100} onClick={() => changed({ ...fields, items: [...fields.items, newLine(categories[0]?.name ?? '')] })}>{t("text141")}</Button>
      </fieldset>
      <Text weight="semibold">{t("text142")}{fields.currency} {total(fields)}</Text>
      <div className="form-actions">
        {editable && <Button appearance="primary" disabled={busy} onClick={() => {
                    void run(async () => accept(await remote.expenseSave(connection.id, {
                        ...(selected ? { id: selected.id, revision: selected.revision } : {}), fields,
                    })));
                }}>{t("text143")}</Button>}
        {dirty && <Button disabled={busy} onClick={() => { setFields(selected?.fields ?? blank(categories[0]?.name ?? '')); setDirty(false); dirtyRef.current = false; onDirtyChange(false); setDialog(false); }}>{t("text144")}</Button>}
        {selected && ['editing', 'review-create', 'created', 'review-submit'].includes(selected.state) && <Button disabled={busy || dirty} onClick={() => {
                    void run(async () => {
                        const value = await remote.expensePrepare(connection.id, selected.id, selected.revision);
                        accept(value);
                        if (alive.current && value.confirmation)
                            setDialog(true);
                    });
                }}>{selected.claimId ? t("text145") : t("text146")}</Button>}
        {selected && ['unknown-create', 'unknown-submit', 'created', 'submitted'].includes(selected.state) && <Button disabled={busy || dirty} onClick={() => { void run(async () => accept(await remote.expenseReconcile(connection.id, selected.id, selected.revision))); }}>{t("text147")}</Button>}
        {selected && ['editing', 'review-create', 'submitted'].includes(selected.state) && <Button disabled={busy || dirty} onClick={() => {
                    void run(async () => {
                        await remote.expenseDelete(connection.id, selected.id, selected.revision);
                        if (alive.current) {
                            setDrafts(rows => rows.filter(row => row.id !== selected.id));
                            setSelected(undefined);
                            setEditor(false);
                        }
                    });
                }}>{t("text148")}</Button>}
      </div>
      {selected?.claimId && <div><Text>{t("text149")}{selected.claimId}{t("text150")}{selected.serverStatus}</Text><br /><Link href={`${connection.origin}/console/objects/expense_claim/${encodeURIComponent(selected.claimId)}`} target="_blank" rel="noreferrer">{t("text151")}</Link></div>}
      <Dialog open={dialog} onOpenChange={(_, data) => { if (!busy)
            setDialog(data.open); }}>
        <DialogSurface><DialogBody><DialogTitle>{selected?.confirmation?.action === 'submit' ? t("text152") : t("text153")}</DialogTitle>
          <DialogContent>
            <p>{connection.identity.tenant.name ?? connection.identity.tenant.slug} · {connection.identity.user.email}</p>
            <p><strong>{fields.title}</strong> · {fields.claimDate} · {fields.currency} {total(fields)}</p>
            <ul>{fields.items.map((line, index) => <li key={index}>{line.expenseDate} · {categories.find(value => value.name === line.category)?.title ?? line.category} · {line.amount} · {line.merchant || t("text154")}{t("text155")}{line.invoiceNumber || t("text156")} · {line.attachment?.filename ?? t("text157")}{line.notes && <p>{line.notes}</p>}</li>)}</ul>
            <p>{selected?.confirmation?.action === 'submit' ? t("text158") : t("text159")}</p>
            <p>{t("text160")}</p>
          </DialogContent>
          <DialogActions><Button disabled={busy} onClick={() => setDialog(false)}>{t("text161")}</Button>
            <Button appearance="primary" disabled={busy || !selected?.confirmation} onClick={() => {
                if (selected?.confirmation)
                    void run(async () => {
                        const value = await remote.expenseConfirm(connection.id, selected.id, selected.revision, selected.confirmation!.token);
                        accept(value);
                        if (alive.current)
                            setDialog(false);
                    });
            }}>{t("text162")}{selected?.confirmation?.action === 'submit' ? t("text163") : t("text164")}</Button></DialogActions>
        </DialogBody></DialogSurface>
      </Dialog>
    </div>}
    <Dialog open={leaveAction !== undefined} onOpenChange={(_, data) => { if (!data.open && !busy)
        setLeaveAction(undefined); }}><DialogSurface><DialogBody><DialogTitle>{t("text165")}</DialogTitle><DialogContent>{t("text166")}{error && <p role="alert">{error}</p>}</DialogContent><DialogActions>
      <Button disabled={busy} onClick={() => setLeaveAction(undefined)}>{t("text167")}</Button>
      <Button disabled={busy} onClick={() => { const action = leaveAction; setLeaveAction(undefined); action?.(); }}>{t("text168")}</Button>
      <Button appearance="primary" disabled={busy} onClick={() => { void run(async () => { const draft = await remote.expenseSave(connection.id, { ...(selected ? { id: selected.id, revision: selected.revision } : {}), fields }); accept(draft); const action = leaveAction; setLeaveAction(undefined); action?.(); }); }}>{t("text169")}</Button>
    </DialogActions></DialogBody></DialogSurface></Dialog>
    <Text size={200}>{t("text170")}</Text>
  </section>;
}
