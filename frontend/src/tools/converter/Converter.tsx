import { ArrowLeft, ArrowLeftRight, Download } from 'lucide-react'
import { useState } from 'react'
import { jsonOptions, requestJson } from '../../api/request'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { ErrorState, LoadingState } from '../../components/ui/feedback'
import { downloadFile } from '../../lib/downloadFile'
import { useTask } from '../../lib/useTask'
import { readUpload } from '../payments/paymentsApi'
import { UploadBox } from '../payments/UploadBox'

const delimiters = [
  [',', 'Κόμμα (,)'],
  [';', 'Ελληνικό ερωτηματικό (;)'],
  ['\t', 'Tab'],
  ['|', 'Κάθετη γραμμή (|)'],
  ['.', 'Τελεία (.)'],
] as const
const control = 'mt-1.5 block h-10 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm disabled:opacity-60'

export default function Converter() {
  const [file, setFile] = useState<File>()
  const [sheets, setSheets] = useState<string[]>([])
  const [content, setContent] = useState('')
  const [sheet, setSheet] = useState('')
  const [inputDelimiter, setInputDelimiter] = useState('auto')
  const [outputDelimiter, setOutputDelimiter] = useState(',')
  const [decimal, setDecimal] = useState('.')
  const [notice, setNotice] = useState('')
  const { busy, error, run, clearError } = useTask()
  const fromExcel = !!file && /\.xlsx?$/i.test(file.name)
  const extension = fromExcel ? '.csv' : '.xlsx'

  function inspect(selected: File) {
    void run('Ανάγνωση φύλλων Excel…', 'Δεν ήταν δυνατή η ανάγνωση του Excel', async () => {
      const encoded = await readUpload(selected)
      const result = await requestJson<{ sheets: string[] }>('/api/converter/sheets', jsonOptions({ filename: selected.name, file: encoded }))
      setContent(encoded)
      setSheets(result.sheets)
      setSheet(result.sheets[0] ?? '')
    })
  }

  function selectFile(selected: File) {
    setNotice('')
    if (!/\.(csv|xlsx|xls)$/i.test(selected.name)) {
      void run('Έλεγχος αρχείου…', 'Μη υποστηριζόμενο αρχείο', async () => {
        throw new Error('Επίλεξε αρχείο .csv, .xlsx ή .xls.')
      })
      return
    }
    clearError()
    setFile(selected)
    setContent('')
    setSheets([])
    setSheet('')
    if (/\.xlsx?$/i.test(selected.name)) inspect(selected)
  }

  function convert() {
    if (!file || (fromExcel && !sheet)) return
    setNotice('')
    void run('Μετατροπή αρχείου…', 'Η μετατροπή απέτυχε', async () => {
      await downloadFile('/api/converter/convert', {
        filename: file.name,
        file: content || await readUpload(file),
        delimiter: fromExcel ? outputDelimiter : inputDelimiter,
        sheet,
        decimal,
      })
      setNotice(`Το αρχείο ${extension} είναι έτοιμο.`)
    })
  }

  return (
    <section className="page-enter mx-auto max-w-3xl" aria-labelledby="converter-heading">
      <a href="#/" className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft size={15} aria-hidden="true" /> Όλα τα εργαλεία
      </a>
      <header className="mb-6">
        <h1 id="converter-heading" className="text-3xl font-semibold tracking-tight sm:text-4xl">CSV ↔ Excel</h1>
        <p className="mt-2 text-sm text-muted-foreground">Πρόσθεσε ένα αρχείο και διάλεξε πώς θα χωρίζονται οι στήλες του CSV.</p>
      </header>
      <Card className="bg-linear-to-br from-card/85 to-primary/10 p-4 sm:p-6">
        <form onSubmit={(event) => { event.preventDefault(); convert() }}>
          <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
            <UploadBox step={1} label="Αρχείο προς μετατροπή" accept=".csv,.xlsx,.xls" filename={file?.name} disabled={!!busy} onFile={selectFile} />
          </div>
          {file && <>
            <div className="my-5 inline-flex max-w-full flex-wrap items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm font-semibold text-primary">
              {fromExcel ? 'Excel' : 'CSV'} <ArrowLeftRight size={15} aria-hidden="true" /> {fromExcel ? 'CSV' : 'Excel (.xlsx)'}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {fromExcel && <label className="text-sm font-medium sm:col-span-2">Φύλλο Excel
                <select className={control} value={sheet} disabled={!!busy || !sheets.length} onChange={(event) => { setSheet(event.target.value); setNotice('') }}>
                  {!sheets.length && <option value="">{busy ? 'Ανάγνωση φύλλων…' : 'Δεν φορτώθηκαν φύλλα'}</option>}
                  {sheets.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>}
              <label className="text-sm font-medium">Διαχωριστικό στηλών CSV
                <select className={control} value={fromExcel ? outputDelimiter : inputDelimiter} disabled={!!busy}
                  onChange={(event) => {
                    if (fromExcel) setOutputDelimiter(event.target.value)
                    else setInputDelimiter(event.target.value)
                    setNotice('')
                  }}>
                  {!fromExcel && <option value="auto">Αυτόματη ανίχνευση</option>}
                  {delimiters.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              {fromExcel && <label className="text-sm font-medium">Δεκαδικό σύμβολο αριθμών
                <select className={control} value={decimal} disabled={!!busy} onChange={(event) => { setDecimal(event.target.value); setNotice('') }}>
                  <option value=".">Τελεία (.)</option>
                  <option value=",">Κόμμα (,)</option>
                </select>
              </label>}
            </div>
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              {fromExcel ? 'Το CSV περιέχει τις τιμές του επιλεγμένου φύλλου.' : 'Οι τιμές του CSV περνούν στο Excel ως κείμενο, ώστε να διατηρούνται τα αρχικά μηδενικά και τα δεκαδικά όπως γράφτηκαν.'}
            </p>
          </>}
          {busy && <LoadingState className="mt-4" title={busy} />}
          {error && <ErrorState className="mt-4" {...error} retry={fromExcel && !sheet && file ? () => inspect(file) : undefined} />}
          {notice && <p className="mt-4 text-sm font-medium text-primary" role="status">{notice}</p>}
          <footer className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
            <p className="text-xs text-muted-foreground">Έως 8 MB · 20.000 γραμμές · 256 στήλες</p>
            <Button type="submit" disabled={!file || !!busy || (fromExcel && !sheet)} className="w-full sm:w-auto">
              <Download size={16} aria-hidden="true" /> Μετατροπή και λήψη
            </Button>
          </footer>
        </form>
      </Card>
    </section>
  )
}
