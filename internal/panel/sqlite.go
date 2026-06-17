package panel

/*
#cgo LDFLAGS: -lsqlite3
#include <stdlib.h>
#include <sqlite3.h>
static int relaycore_bind_text(sqlite3_stmt* stmt, int idx, const char* value, int len) {
	return sqlite3_bind_text(stmt, idx, value, len, SQLITE_TRANSIENT);
}
*/
import "C"

import (
	"fmt"
	"unsafe"
)

type sqliteDB struct {
	db *C.sqlite3
}

func openSQLite(path string) (*sqliteDB, error) {
	cpath := C.CString(path)
	defer C.free(unsafe.Pointer(cpath))
	var raw *C.sqlite3
	rc := C.sqlite3_open_v2(cpath, &raw, C.SQLITE_OPEN_READWRITE|C.SQLITE_OPEN_CREATE|C.SQLITE_OPEN_FULLMUTEX, nil)
	if rc != C.SQLITE_OK {
		msg := "unknown"
		if raw != nil {
			msg = C.GoString(C.sqlite3_errmsg(raw))
			C.sqlite3_close(raw)
		}
		return nil, fmt.Errorf("open sqlite: %s", msg)
	}
	db := &sqliteDB{db: raw}
	if err := db.execRaw("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);"); err != nil {
		_ = db.close()
		return nil, err
	}
	return db, nil
}

func (d *sqliteDB) close() error {
	if d == nil || d.db == nil {
		return nil
	}
	if rc := C.sqlite3_close(d.db); rc != C.SQLITE_OK {
		return fmt.Errorf("close sqlite: %s", C.GoString(C.sqlite3_errmsg(d.db)))
	}
	d.db = nil
	return nil
}

func (d *sqliteDB) execRaw(sql string) error {
	csql := C.CString(sql)
	defer C.free(unsafe.Pointer(csql))
	var errMsg *C.char
	rc := C.sqlite3_exec(d.db, csql, nil, nil, &errMsg)
	if rc != C.SQLITE_OK {
		defer C.sqlite3_free(unsafe.Pointer(errMsg))
		return fmt.Errorf("sqlite exec: %s", C.GoString(errMsg))
	}
	return nil
}

func (d *sqliteDB) prepare(sql string) (*C.sqlite3_stmt, error) {
	csql := C.CString(sql)
	defer C.free(unsafe.Pointer(csql))
	var stmt *C.sqlite3_stmt
	rc := C.sqlite3_prepare_v2(d.db, csql, -1, &stmt, nil)
	if rc != C.SQLITE_OK {
		return nil, fmt.Errorf("sqlite prepare: %s", C.GoString(C.sqlite3_errmsg(d.db)))
	}
	return stmt, nil
}

func (d *sqliteDB) bindText(stmt *C.sqlite3_stmt, idx int, value string) error {
	cs := C.CString(value)
	defer C.free(unsafe.Pointer(cs))
	rc := C.relaycore_bind_text(stmt, C.int(idx), cs, C.int(len(value)))
	if rc != C.SQLITE_OK {
		return fmt.Errorf("sqlite bind: %s", C.GoString(C.sqlite3_errmsg(d.db)))
	}
	return nil
}

func (d *sqliteDB) putKV(key, value string) error {
	stmt, err := d.prepare("INSERT INTO kv(k, v, updated_at) VALUES(?, ?, CURRENT_TIMESTAMP) ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=CURRENT_TIMESTAMP")
	if err != nil {
		return err
	}
	defer C.sqlite3_finalize(stmt)
	if err := d.bindText(stmt, 1, key); err != nil {
		return err
	}
	if err := d.bindText(stmt, 2, value); err != nil {
		return err
	}
	if rc := C.sqlite3_step(stmt); rc != C.SQLITE_DONE {
		return fmt.Errorf("sqlite put: %s", C.GoString(C.sqlite3_errmsg(d.db)))
	}
	return nil
}

func (d *sqliteDB) getKV(key string) (string, bool, error) {
	stmt, err := d.prepare("SELECT v FROM kv WHERE k = ?")
	if err != nil {
		return "", false, err
	}
	defer C.sqlite3_finalize(stmt)
	if err := d.bindText(stmt, 1, key); err != nil {
		return "", false, err
	}
	rc := C.sqlite3_step(stmt)
	if rc == C.SQLITE_DONE {
		return "", false, nil
	}
	if rc != C.SQLITE_ROW {
		return "", false, fmt.Errorf("sqlite get: %s", C.GoString(C.sqlite3_errmsg(d.db)))
	}
	text := C.sqlite3_column_text(stmt, 0)
	if text == nil {
		return "", true, nil
	}
	return C.GoString((*C.char)(unsafe.Pointer(text))), true, nil
}
