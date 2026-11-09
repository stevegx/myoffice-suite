# MyOffice Suite

Χώρος εργασίας για καθημερινές εμπορικές εργασίες, από τον έλεγχο πληρωμών και τιμών έως το ιστορικό προϊόντων.

![Το μενού εργαλείων του MyOffice Suite σε σκοτεινό θέμα](docs/screenshots/tool-menu.png)

## Εργαλεία

| Εργαλείο | Τι κάνει |
| --- | --- |
| **Πληρωμές** | Συγκεντρώνει πληρωμές Skroutz και παραστατικά ERP σε έναν πίνακα για έλεγχο, συμπλήρωση κωδικών πελατών και εξαγωγή σε Excel. |
| **Repricing** | Παρουσιάζει προτάσεις τιμών για Skroutz και site, με επεξεργασία στον πίνακα, φίλτρα και σύνοψη μεταβολών. Εξάγει τις επιλεγμένες αλλαγές ανά κανάλι. |
| **Προϊόντα** | Κατάλογος με αναζήτηση ανά SKU ή όνομα, χρονολόγιο μεταβολών και γραφήματα τιμών ανά κανάλι. |
| **Paper Product Tool** | Συντόμευση προς το εξωτερικό εργαλείο για προϊόντα χαρτιού. |
| **Κατάσταση συστήματος** | Δείχνει τη διαθεσιμότητα του API και της βάσης δεδομένων. |

Το περιβάλλον υποστηρίζει φωτεινό και σκοτεινό θέμα, αναδιάταξη καρτών και πίνακες εργασίας με αναζήτηση και φίλτρα. Τα εργαλεία εμφανίζουν την πρόοδο στις εισαγωγές, στις εξαγωγές και στους ελέγχους. Όταν μια ενέργεια αποτύχει, μπορείς να δοκιμάσεις ξανά ή να διορθώσεις το αρχείο διατηρώντας την εργασία σου.

## Τεχνολογίες

React, TypeScript, Vite, Tailwind CSS, Python, FastAPI και SQLite.

## Τοπική εκτέλεση στα Windows

Χρειάζεσαι Python 3.15 και Node.js 24 ή νεότερη συμβατή έκδοση. Κάνε διπλό κλικ στο [Run-MyOffice.bat](Run-MyOffice.bat) για να ξεκινήσουν backend και frontend σε δύο παράθυρα. Στην πρώτη εκτέλεση εγκαθίστανται οι απαραίτητες εξαρτήσεις. Όταν είναι έτοιμα, άνοιξε το [MyOffice Suite](http://127.0.0.1:5173).

Ο κατάλογος και το ιστορικό τιμών αποθηκεύονται στην τοπική SQLite (`backend/data/myoffice.db`). Ο κατάλογος ενημερώνεται ανά SKU με κάθε εισαγωγή στο Repricing και διατηρεί τα προϊόντα προηγούμενων εισαγωγών.

### Χειροκίνητη εκκίνηση

Από τη ρίζα του repository, ξεκίνησε το backend.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 5072
```

Αν το περιβάλλον Python βρίσκεται ήδη μέσα στον φάκελο `backend`, χρησιμοποίησε το `backend\.venv\Scripts\python.exe`.

Σε δεύτερο τερματικό, ξεκίνησε το frontend.

```powershell
cd frontend
npm.cmd ci
npm.cmd run dev
```

Άνοιξε το [MyOffice Suite](http://127.0.0.1:5173).

### Docker

```powershell
docker build -t myoffice-suite .
docker run --rm -p 127.0.0.1:8080:8080 myoffice-suite
```

Άνοιξε το [MyOffice Suite μέσω Docker](http://127.0.0.1:8080). Το Docker image ξεκινά με το ιστορικό προϊόντων απενεργοποιημένο για χρήση ως demo.

Για προσωπική χρήση μέσω Docker, ενεργοποίησε το ιστορικό και σύνδεσε μόνιμο volume στη βάση.

```powershell
docker run --rm -p 127.0.0.1:8080:8080 -e MYOFFICE_PRODUCT_HISTORY=1 --mount type=volume,source=myoffice-data,target=/app/backend/data myoffice-suite
```
