import { useState, useMemo, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.REACT_APP_SUPABASE_ANON_KEY // ← anon keyを貼り付け
);

// ============================================================
// CONFIG: 曜日・枠・定員設定
// ============================================================
const SCHEDULE_CONFIG = {
  3: {
    // 水曜 (0=日, 1=月, 2=火, 3=水...)
    dayLabel: "水曜日",
    slots: ["10:00", "11:00", "13:00", "14:00"],
    maxPerSlot: 5,
  },
  5: {
    // 金曜
    dayLabel: "金曜日",
    slots: ["10:00", "11:00"],
    maxPerSlot: 5,
  },
};

const DAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"];

// ============================================================
// デモ用の初期予約データ生成
// ============================================================
function generateDemoBookings() {
  const bookings = [];
  const names = [
    "田中 花子",
    "佐藤 美咲",
    "鈴木 由美",
    "山田 あかり",
    "中村 さくら",
    "伊藤 なな",
    "小林 ひより",
  ];
  const today = new Date();

  // 直近4週分の水・金に予約を入れる
  for (let week = 0; week < 4; week++) {
    [3, 5].forEach((dow) => {
      const config = SCHEDULE_CONFIG[dow];
      config.slots.forEach((time, si) => {
        const count = Math.floor(Math.random() * 4); // 0〜3人
        for (let p = 0; p < count; p++) {
          const d = new Date(today);
          const diff = (dow - today.getDay() + 7) % 7 || 7;
          d.setDate(today.getDate() + diff + week * 7);
          bookings.push({
            id: `demo_${dow}_${week}_${si}_${p}`,
            date: dateStr(d),
            time,
            name: names[bookings.length % names.length],
            email: "demo@example.com",
            status: "confirmed",
          });
        }
      });
    });
  }
  return bookings;
}

function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseDateStr(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatDateJP(s) {
  const d = parseDateStr(s);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${
    DAY_NAMES[d.getDay()]
  }）`;
}

// ============================================================
export default function App() {
  const isAdmin =
    new URLSearchParams(window.location.search).get("admin") === "true";
  const [view, setView] = useState(isAdmin ? "admin" : "client");
  const [bookings, setBookings] = useState([]);

  useEffect(() => {
    const fetchBookings = async () => {
      const { data } = await supabase
        .from("bookings")
        .select("*")
        .eq("status", "confirmed");
      if (data) setBookings(data);
    };
    fetchBookings();
  }, []);

  // 予約フロー state
  const [step, setStep] = useState(1); // 1:日程選択 2:お客様情報 3:完了
  const [selectedDate, setSelectedDate] = useState(null); // "YYYY-MM-DD"
  const [selectedTime, setSelectedTime] = useState(null);
  const [form, setForm] = useState({ name: "", email: "" });

  // カレンダー表示月
  const today = new Date();
  const [calYM, setCalYM] = useState({
    year: today.getFullYear(),
    month: today.getMonth(),
  });

  // Toast
  const [toast, setToast] = useState(null);
  const showToast = (msg, color = "#5C8A6E") => {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 3000);
  };

  // キャンセル確認
  const [cancelTarget, setCancelTarget] = useState(null);

  // ============================================================
  // 予約カウント集計
  // ============================================================
  const bookingMap = useMemo(() => {
    // { "YYYY-MM-DD_HH:MM": count }
    const map = {};
    bookings.forEach((b) => {
      if (b.status !== "confirmed") return;
      const key = `${b.date}_${b.time}`;
      map[key] = (map[key] || 0) + 1;
    });
    return map;
  }, [bookings]);

  const getCount = (date, time) => bookingMap[`${date}_${time}`] || 0;

  // ============================================================
  // カレンダー計算
  // ============================================================
  const { firstDow, daysTotal } = useMemo(() => {
    const { year, month } = calYM;
    return {
      firstDow: new Date(year, month, 1).getDay(),
      daysTotal: new Date(year, month + 1, 0).getDate(),
    };
  }, [calYM]);

  const isAvailableDate = (day) => {
    const d = new Date(calYM.year, calYM.month, day);
    const todayMidnight = new Date(today);
    todayMidnight.setHours(0, 0, 0, 0);
    if (d < todayMidnight) return false;
    return d.getDay() in SCHEDULE_CONFIG;
  };

  const getDayConfig = (dateS) => {
    const dow = parseDateStr(dateS).getDay();
    return SCHEDULE_CONFIG[dow] || null;
  };

  // ============================================================
  // 予約確定
  // ============================================================
  const handleBook = async () => {
    const { data, error } = await supabase
      .from("bookings")
      .insert({
        date: selectedDate,
        time: selectedTime,
        name: form.name,
        email: form.email,
        status: "confirmed",
      })
      .select();
    if (error) {
      showToast("予約に失敗しました", "#C87070");
      return;
    }
    setBookings((p) => [...p, data[0]]);
    setStep(3);
    showToast("✓ 予約が完了しました！");
  };

  const handleCancel = async (id) => {
    const { error } = await supabase
      .from("bookings")
      .update({ status: "cancelled" })
      .eq("id", id);
    if (error) {
      showToast("キャンセルに失敗しました", "#C87070");
      return;
    }
    setBookings((p) =>
      p.map((b) => (b.id === id ? { ...b, status: "cancelled" } : b))
    );
    setCancelTarget(null);
    showToast("予約をキャンセルしました。", "#A07060");
  };

  const resetFlow = () => {
    setStep(1);
    setSelectedDate(null);
    setSelectedTime(null);
    setForm({ name: "", email: "" });
  };

  // ============================================================
  // Admin: 今後の予約一覧
  // ============================================================
  const todayS = dateStr(today);
  const upcomingBookings = useMemo(
    () =>
      bookings
        .filter((b) => b.status === "confirmed" && b.date >= todayS)
        .sort(
          (a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)
        ),
    [bookings, todayS]
  );

  const config = selectedDate ? getDayConfig(selectedDate) : null;

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#F2EEE8",
        fontFamily: "'Hiragino Sans', 'Noto Sans JP', sans-serif",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant:ital,wght@0,300;0,400;0,500;1,300&family=Noto+Sans+JP:wght@300;400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --sage: #5C8A6E;
          --sage-light: #EAF2EE;
          --sage-dark: #3E6B52;
          --warm: #8A6C5C;
          --text: #2A2A2A;
          --muted: #888;
          --bg: #F2EEE8;
          --surface: #FDFCFA;
          --border: #E0DAD2;
        }
        .serif { font-family: 'Cormorant', Georgia, serif; }
        .sans { font-family: 'Noto Sans JP', sans-serif; }

        /* Animations */
        @keyframes fadeUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        @keyframes slideRight { from { opacity:0; transform:translateX(-8px); } to { opacity:1; transform:translateX(0); } }
        @keyframes toastIn { from { opacity:0; transform:translateY(-12px) scale(0.96); } to { opacity:1; transform:translateY(0) scale(1); } }
        .fade-up { animation: fadeUp 0.4s ease forwards; }
        .slide-right { animation: slideRight 0.3s ease forwards; }

        /* Nav tabs */
        .nav-tab { padding: 8px 20px; background: none; border: none; cursor: pointer; font-family: 'Noto Sans JP', sans-serif; font-size: 13px; color: var(--muted); letter-spacing: 0.08em; border-bottom: 2px solid transparent; transition: all 0.2s; }
        .nav-tab.active { color: var(--sage); border-bottom-color: var(--sage); font-weight: 500; }

        /* Calendar */
        .cal-day { width: 38px; height: 38px; border: none; background: none; cursor: pointer; border-radius: 50%; font-family: 'Noto Sans JP', sans-serif; font-size: 13px; color: var(--text); transition: all 0.15s; position: relative; display: flex; align-items: center; justify-content: center; margin: 0 auto; }
        .cal-day:hover:not(:disabled) { background: var(--sage-light); }
        .cal-day.is-available { color: var(--sage); font-weight: 500; }
        .cal-day.is-selected { background: var(--sage) !important; color: white !important; }
        .cal-day:disabled { color: #CCC; cursor: default; }
        .cal-day.is-available::after { content: ''; position: absolute; bottom: 5px; left: 50%; transform: translateX(-50%); width: 4px; height: 4px; border-radius: 50%; background: var(--sage); opacity: 0.5; }
        .cal-day.is-selected::after { background: white; opacity: 0.7; }

        /* Slot buttons */
        .slot-btn { padding: 14px 12px; border: 1.5px solid var(--border); background: var(--surface); cursor: pointer; transition: all 0.2s; text-align: center; }
        .slot-btn:hover:not(.full):not(.selected) { border-color: var(--sage); background: var(--sage-light); }
        .slot-btn.selected { border-color: var(--sage); background: var(--sage-light); }
        .slot-btn.full { background: #F5F3F0; cursor: not-allowed; border-color: var(--border); }

        /* Inputs */
        .inp { width: 100%; padding: 13px 16px; border: 1.5px solid var(--border); background: var(--surface); font-family: 'Noto Sans JP', sans-serif; font-size: 14px; color: var(--text); outline: none; transition: border-color 0.2s; }
        .inp:focus { border-color: var(--sage); }

        /* Buttons */
        .btn-p { background: var(--sage); color: white; border: none; padding: 14px 28px; font-family: 'Noto Sans JP', sans-serif; font-size: 14px; cursor: pointer; transition: all 0.2s; letter-spacing: 0.05em; }
        .btn-p:hover { background: var(--sage-dark); }
        .btn-p:disabled { background: #C5D5CC; cursor: not-allowed; }
        .btn-o { background: transparent; color: var(--sage); border: 1.5px solid var(--sage); padding: 12px 24px; font-family: 'Noto Sans JP', sans-serif; font-size: 14px; cursor: pointer; transition: all 0.2s; }
        .btn-o:hover { background: var(--sage-light); }
        .btn-danger { background: #B85C5C; color: white; border: none; padding: 13px 24px; font-family: 'Noto Sans JP', sans-serif; font-size: 14px; cursor: pointer; transition: background 0.2s; }
        .btn-danger:hover { background: #9E4444; }

        /* Cards */
        .card { background: var(--surface); box-shadow: 0 2px 16px rgba(0,0,0,0.05); }

        /* Progress bar */
        .progress-track { height: 2px; background: var(--border); }
        .progress-fill { height: 2px; background: var(--sage); transition: width 0.4s ease; }

        /* Capacity bar */
        .cap-bar { height: 4px; background: #E8E2DA; border-radius: 2px; overflow: hidden; }
        .cap-fill { height: 100%; border-radius: 2px; transition: width 0.3s; }

        /* Toast */
        .toast { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); padding: 13px 24px; background: white; border-radius: 2px; box-shadow: 0 6px 32px rgba(0,0,0,0.12); font-family: 'Noto Sans JP', sans-serif; font-size: 13px; z-index: 9999; animation: toastIn 0.3s ease; white-space: nowrap; border-top: 3px solid var(--sage); }

        /* Modal */
        .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.35); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 20px; backdrop-filter: blur(2px); }
        .modal { background: var(--surface); padding: 36px; max-width: 400px; width: 100%; animation: fadeUp 0.25s ease; }

        /* Booking row */
        .brow { display: flex; align-items: center; gap: 16px; padding: 16px 0; border-bottom: 1px solid var(--border); }
        .brow:last-child { border-bottom: none; }

        /* Week schedule grid */
        .week-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        /* ===== スマホ対応 ===== */
        @media (max-width: 640px) {
          .two-col-grid { grid-template-columns: 1fr !important; }
          .week-grid { grid-template-columns: 1fr !important; }
          .cal-day { width: 34px; height: 34px; font-size: 12px; }
          .slot-btn { padding: 12px 10px; }
          .modal { padding: 24px !important; }
          .brow { flex-wrap: wrap; }
          header .serif { font-size: 17px !important; }
          header .sans { display: none; }
          .nav-tab { padding: 8px 12px; font-size: 12px; }
        }
      `}</style>

      {/* Toast */}
      {toast && (
        <div className="toast sans" style={{ borderTopColor: toast.color }}>
          {toast.msg}
        </div>
      )}

      {/* Cancel Modal */}
      {cancelTarget && (
        <div className="overlay" onClick={() => setCancelTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <p
              className="serif"
              style={{ fontSize: 24, marginBottom: 8, color: "var(--text)" }}
            >
              予約のキャンセル
            </p>
            <p
              className="sans"
              style={{
                fontSize: 13,
                color: "var(--muted)",
                lineHeight: 1.9,
                marginBottom: 28,
              }}
            >
              {formatDateJP(cancelTarget.date)} {cancelTarget.time}〜<br />
              <strong style={{ color: "var(--text)" }}>
                {cancelTarget.name}
              </strong>{" "}
              様の予約をキャンセルしますか？
            </p>
            <div style={{ display: "flex", gap: 12 }}>
              <button
                className="btn-o sans"
                style={{ flex: 1 }}
                onClick={() => setCancelTarget(null)}
              >
                戻る
              </button>
              <button
                className="btn-danger sans"
                style={{ flex: 1 }}
                onClick={() => handleCancel(cancelTarget.id)}
              >
                キャンセルする
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <header
        style={{
          background: "var(--surface)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div
          style={{
            maxWidth: 860,
            margin: "0 auto",
            padding: "0 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: 60,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span
              className="serif"
              style={{
                fontSize: 22,
                letterSpacing: "0.06em",
                color: "var(--text)",
              }}
            >
              Pilates Studio
            </span>
            <span
              className="sans"
              style={{
                fontSize: 10,
                color: "var(--muted)",
                letterSpacing: "0.15em",
                textTransform: "uppercase",
              }}
            >
              Reservation
            </span>
          </div>
          <nav style={{ display: "flex" }}>
            {isAdmin ? (
              <>
                <button
                  className={`nav-tab sans ${
                    view === "client" ? "active" : ""
                  }`}
                  onClick={() => {
                    setView("client");
                    resetFlow();
                  }}
                >
                  予約する
                </button>
                <button
                  className={`nav-tab sans ${view === "admin" ? "active" : ""}`}
                  onClick={() => setView("admin")}
                >
                  管理画面
                </button>
              </>
            ) : null}
          </nav>
        </div>
        {/* Progress bar (client only) */}
        {view === "client" && step < 3 && (
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: step === 1 ? "50%" : "90%" }}
            />
          </div>
        )}
      </header>

      {/* ── Main ── */}
      <main style={{ maxWidth: 860, margin: "0 auto", padding: "32px 20px" }}>
        {/* ========== CLIENT VIEW ========== */}
        {view === "client" && (
          <>
            {/* ── Step 1: 日程・時間選択 ── */}
            {step === 1 && (
              <div
                className="fade-up two-col-grid"
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 20,
                }}
              >
                {/* Calendar */}
                <div className="card" style={{ padding: 24 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 20,
                    }}
                  >
                    <button
                      onClick={() =>
                        setCalYM((p) => {
                          const d = new Date(p.year, p.month - 1);
                          return { year: d.getFullYear(), month: d.getMonth() };
                        })
                      }
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--muted)",
                        fontSize: 20,
                        lineHeight: 1,
                        padding: "4px 10px",
                      }}
                    >
                      ‹
                    </button>
                    <span
                      className="serif"
                      style={{ fontSize: 20, color: "var(--text)" }}
                    >
                      {calYM.year}年 {calYM.month + 1}月
                    </span>
                    <button
                      onClick={() =>
                        setCalYM((p) => {
                          const d = new Date(p.year, p.month + 1);
                          return { year: d.getFullYear(), month: d.getMonth() };
                        })
                      }
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--muted)",
                        fontSize: 20,
                        lineHeight: 1,
                        padding: "4px 10px",
                      }}
                    >
                      ›
                    </button>
                  </div>

                  {/* Day labels */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(7, 1fr)",
                      marginBottom: 6,
                    }}
                  >
                    {DAY_NAMES.map((d, i) => (
                      <div
                        key={d}
                        className="sans"
                        style={{
                          textAlign: "center",
                          fontSize: 11,
                          color:
                            i === 0
                              ? "#C88"
                              : i === 6
                              ? "#88C"
                              : "var(--muted)",
                          padding: "4px 0",
                          fontWeight: 500,
                        }}
                      >
                        {d}
                      </div>
                    ))}
                  </div>

                  {/* Days grid */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(7, 1fr)",
                      gap: "4px 0",
                    }}
                  >
                    {Array(firstDow)
                      .fill(null)
                      .map((_, i) => (
                        <div key={`e${i}`} />
                      ))}
                    {Array(daysTotal)
                      .fill(null)
                      .map((_, i) => {
                        const day = i + 1;
                        const ds = `${calYM.year}-${String(
                          calYM.month + 1
                        ).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                        const avail = isAvailableDate(day);
                        const selected = selectedDate === ds;
                        const dow = new Date(
                          calYM.year,
                          calYM.month,
                          day
                        ).getDay();
                        return (
                          <button
                            key={day}
                            className={`cal-day sans ${
                              avail ? "is-available" : ""
                            } ${selected ? "is-selected" : ""}`}
                            disabled={!avail}
                            style={{
                              color: !avail
                                ? dow === 0
                                  ? "#DDB"
                                  : undefined
                                : undefined,
                            }}
                            onClick={() => {
                              setSelectedDate(ds);
                              setSelectedTime(null);
                            }}
                          >
                            {day}
                          </button>
                        );
                      })}
                  </div>

                  <div
                    style={{
                      marginTop: 16,
                      padding: "12px 14px",
                      background: "var(--sage-light)",
                      display: "flex",
                      gap: 20,
                    }}
                  >
                    {Object.entries(SCHEDULE_CONFIG).map(([dow, cfg]) => (
                      <div
                        key={dow}
                        className="sans"
                        style={{ fontSize: 11, color: "var(--sage)" }}
                      >
                        <span style={{ fontWeight: 500 }}>{cfg.dayLabel}</span>
                        <span style={{ color: "var(--muted)", marginLeft: 4 }}>
                          {cfg.slots.length}枠 / 各{cfg.maxPerSlot}名
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Time Slots */}
                <div className="card" style={{ padding: 24 }}>
                  {!selectedDate ? (
                    <div
                      style={{
                        height: "100%",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        alignItems: "center",
                        gap: 12,
                        opacity: 0.4,
                      }}
                    >
                      <div style={{ fontSize: 40 }}>📅</div>
                      <p
                        className="sans"
                        style={{
                          fontSize: 13,
                          color: "var(--muted)",
                          textAlign: "center",
                        }}
                      >
                        カレンダーから
                        <br />
                        日付を選んでください
                      </p>
                      <p
                        className="sans"
                        style={{ fontSize: 11, color: "var(--muted)" }}
                      >
                        水曜・金曜のみ予約可能
                      </p>
                    </div>
                  ) : (
                    <div className="slide-right">
                      <p
                        className="serif"
                        style={{ fontSize: 20, marginBottom: 4 }}
                      >
                        {formatDateJP(selectedDate)}
                      </p>
                      <p
                        className="sans"
                        style={{
                          fontSize: 12,
                          color: "var(--muted)",
                          marginBottom: 20,
                        }}
                      >
                        時間帯を選択してください
                      </p>

                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 10,
                        }}
                      >
                        {config?.slots.map((t) => {
                          const count = getCount(selectedDate, t);
                          const max = config.maxPerSlot;
                          const remaining = max - count;
                          const full = remaining <= 0;
                          const selected = selectedTime === t;
                          const pct = Math.min(100, (count / max) * 100);
                          const fillColor =
                            pct < 60
                              ? "var(--sage)"
                              : pct < 90
                              ? "#C8A85A"
                              : "#C87070";

                          return (
                            <button
                              key={t}
                              className={`slot-btn sans ${
                                full ? "full" : selected ? "selected" : ""
                              }`}
                              onClick={() => !full && setSelectedTime(t)}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                  marginBottom: 8,
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: 16,
                                    fontWeight: 500,
                                    color: full
                                      ? "#BBB"
                                      : selected
                                      ? "var(--sage-dark)"
                                      : "var(--text)",
                                    fontFamily: "'Cormorant', serif",
                                  }}
                                >
                                  {t}〜
                                </span>
                                <span
                                  className="sans"
                                  style={{
                                    fontSize: 11,
                                    color: full
                                      ? "#BBB"
                                      : remaining <= 2
                                      ? "#C87070"
                                      : "var(--muted)",
                                  }}
                                >
                                  {full ? "満席" : `残り ${remaining}名`}
                                </span>
                              </div>
                              <div className="cap-bar">
                                <div
                                  className="cap-fill"
                                  style={{
                                    width: `${pct}%`,
                                    background: full ? "#DDD" : fillColor,
                                  }}
                                />
                              </div>
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "flex-end",
                                  marginTop: 4,
                                }}
                              >
                                <span
                                  className="sans"
                                  style={{ fontSize: 10, color: "#AAA" }}
                                >
                                  {count} / {max}名
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      {selectedTime && (
                        <button
                          className="btn-p sans"
                          style={{ width: "100%", marginTop: 20 }}
                          onClick={() => setStep(2)}
                        >
                          次へ進む →
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Step 2: お客様情報 ── */}
            {step === 2 && (
              <div
                className="fade-up card"
                style={{ maxWidth: 460, margin: "0 auto", padding: 36 }}
              >
                <p className="serif" style={{ fontSize: 26, marginBottom: 4 }}>
                  お客様情報の入力
                </p>
                <p
                  className="sans"
                  style={{
                    fontSize: 13,
                    color: "var(--muted)",
                    marginBottom: 28,
                  }}
                >
                  {formatDateJP(selectedDate)}　{selectedTime}〜
                </p>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 18,
                    marginBottom: 28,
                  }}
                >
                  <div>
                    <label
                      className="sans"
                      style={{
                        fontSize: 12,
                        color: "var(--muted)",
                        display: "block",
                        marginBottom: 7,
                        letterSpacing: "0.05em",
                      }}
                    >
                      お名前 *
                    </label>
                    <input
                      className="inp sans"
                      placeholder="山田 花子"
                      value={form.name}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, name: e.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <label
                      className="sans"
                      style={{
                        fontSize: 12,
                        color: "var(--muted)",
                        display: "block",
                        marginBottom: 7,
                        letterSpacing: "0.05em",
                      }}
                    >
                      メールアドレス *
                    </label>
                    <input
                      className="inp sans"
                      type="email"
                      placeholder="hanako@example.com"
                      value={form.email}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, email: e.target.value }))
                      }
                    />
                  </div>
                </div>

                {/* Confirmation summary */}
                <div
                  style={{
                    background: "var(--sage-light)",
                    padding: "16px 20px",
                    marginBottom: 24,
                  }}
                >
                  <p
                    className="sans"
                    style={{
                      fontSize: 11,
                      color: "var(--sage)",
                      letterSpacing: "0.1em",
                      marginBottom: 10,
                      fontWeight: 500,
                    }}
                  >
                    予約内容の確認
                  </p>
                  {[
                    [
                      "日時",
                      `${formatDateJP(selectedDate)}　${selectedTime}〜`,
                    ],
                    [
                      "残席",
                      `あと ${
                        config?.maxPerSlot -
                        getCount(selectedDate, selectedTime)
                      } 名`,
                    ],
                  ].map(([k, v]) => (
                    <div
                      key={k}
                      style={{ display: "flex", gap: 16, marginBottom: 6 }}
                    >
                      <span
                        className="sans"
                        style={{
                          fontSize: 12,
                          color: "var(--muted)",
                          minWidth: 40,
                        }}
                      >
                        {k}
                      </span>
                      <span
                        className="sans"
                        style={{
                          fontSize: 12,
                          color: "var(--text)",
                          fontWeight: 500,
                        }}
                      >
                        {v}
                      </span>
                    </div>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 12 }}>
                  <button className="btn-o sans" onClick={() => setStep(1)}>
                    ← 戻る
                  </button>
                  <button
                    className="btn-p sans"
                    style={{ flex: 1 }}
                    disabled={!form.name || !form.email}
                    onClick={handleBook}
                  >
                    予約を確定する
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 3: 完了 ── */}
            {step === 3 && (
              <div
                className="fade-up card"
                style={{
                  maxWidth: 440,
                  margin: "0 auto",
                  padding: "52px 36px",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: "50%",
                    background: "var(--sage-light)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 24px",
                    fontSize: 28,
                  }}
                >
                  ✓
                </div>
                <p
                  className="serif"
                  style={{
                    fontSize: 30,
                    color: "var(--sage)",
                    marginBottom: 8,
                  }}
                >
                  予約完了
                </p>
                <p
                  className="sans"
                  style={{
                    fontSize: 13,
                    color: "var(--muted)",
                    lineHeight: 1.9,
                    marginBottom: 32,
                  }}
                >
                  ご予約ありがとうございます。
                  <br />
                  {form.email} に確認メールをお送りしました。
                </p>
                <div
                  style={{
                    background: "var(--bg)",
                    padding: "20px 24px",
                    marginBottom: 32,
                    textAlign: "left",
                  }}
                >
                  {[
                    [
                      "日時",
                      `${formatDateJP(selectedDate)}　${selectedTime}〜`,
                    ],
                    ["お名前", `${form.name} 様`],
                  ].map(([k, v]) => (
                    <div
                      key={k}
                      style={{ display: "flex", gap: 16, marginBottom: 8 }}
                    >
                      <span
                        className="sans"
                        style={{
                          fontSize: 13,
                          color: "var(--muted)",
                          minWidth: 48,
                        }}
                      >
                        {k}
                      </span>
                      <span
                        className="sans"
                        style={{
                          fontSize: 13,
                          color: "var(--text)",
                          fontWeight: 500,
                        }}
                      >
                        {v}
                      </span>
                    </div>
                  ))}
                </div>
                <button className="btn-o sans" onClick={resetFlow}>
                  別の予約をする
                </button>
              </div>
            )}
          </>
        )}

        {/* ========== ADMIN VIEW ========== */}
        {view === "admin" && (
          <div className="fade-up">
            {/* 週間スケジュール概要 */}
            <div className="week-grid" style={{ marginBottom: 20 }}>
              {Object.entries(SCHEDULE_CONFIG).map(([dow, cfg]) => {
                // 次のその曜日の日付
                const diff = (Number(dow) - today.getDay() + 7) % 7 || 7;
                const nextDate = new Date(today);
                nextDate.setDate(today.getDate() + diff);
                const ds = dateStr(nextDate);
                return (
                  <div key={dow} className="card" style={{ padding: 20 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        marginBottom: 16,
                      }}
                    >
                      <div>
                        <span
                          className="serif"
                          style={{ fontSize: 22, color: "var(--text)" }}
                        >
                          {cfg.dayLabel}
                        </span>
                        <p
                          className="sans"
                          style={{
                            fontSize: 11,
                            color: "var(--muted)",
                            marginTop: 2,
                          }}
                        >
                          {formatDateJP(ds)}（次回）
                        </p>
                      </div>
                      <span
                        className="sans"
                        style={{
                          fontSize: 11,
                          background: "var(--sage-light)",
                          color: "var(--sage)",
                          padding: "4px 10px",
                          fontWeight: 500,
                        }}
                      >
                        {cfg.slots.length}枠 / 各{cfg.maxPerSlot}名
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      {cfg.slots.map((t) => {
                        const cnt = getCount(ds, t);
                        const pct = Math.min(100, (cnt / cfg.maxPerSlot) * 100);
                        const fillColor =
                          pct === 0
                            ? "var(--border)"
                            : pct < 60
                            ? "var(--sage)"
                            : pct < 90
                            ? "#C8A85A"
                            : "#C87070";
                        return (
                          <div key={t}>
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                marginBottom: 4,
                              }}
                            >
                              <span
                                className="sans"
                                style={{ fontSize: 12, color: "var(--text)" }}
                              >
                                {t}
                              </span>
                              <span
                                className="sans"
                                style={{ fontSize: 11, color: "var(--muted)" }}
                              >
                                {cnt} / {cfg.maxPerSlot}名
                              </span>
                            </div>
                            <div className="cap-bar">
                              <div
                                className="cap-fill"
                                style={{
                                  width: `${pct}%`,
                                  background: fillColor,
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 予約一覧 */}
            <div className="card" style={{ padding: 28 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 20,
                }}
              >
                <p className="serif" style={{ fontSize: 22 }}>
                  予約一覧
                </p>
                <span
                  className="sans"
                  style={{ fontSize: 12, color: "var(--muted)" }}
                >
                  今後の予約 {upcomingBookings.length} 件
                </span>
              </div>
              {upcomingBookings.length === 0 ? (
                <p
                  className="sans"
                  style={{
                    color: "var(--muted)",
                    textAlign: "center",
                    padding: "32px 0",
                    fontSize: 13,
                  }}
                >
                  予約はありません
                </p>
              ) : (
                upcomingBookings.map((b) => {
                  const dow = parseDateStr(b.date).getDay();
                  const cfg = SCHEDULE_CONFIG[dow];
                  const cnt = getCount(b.date, b.time);
                  const dotColor = dow === 3 ? "var(--sage)" : "var(--warm)";
                  return (
                    <div key={b.id} className="brow">
                      <div
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          background: dotColor,
                          flexShrink: 0,
                        }}
                      />
                      <div style={{ flex: 1 }}>
                        <p
                          className="sans"
                          style={{
                            fontSize: 14,
                            fontWeight: 500,
                            marginBottom: 2,
                          }}
                        >
                          {b.name}
                        </p>
                        <p
                          className="sans"
                          style={{ fontSize: 12, color: "var(--muted)" }}
                        >
                          {formatDateJP(b.date)}　{b.time}〜
                          <span
                            style={{
                              marginLeft: 10,
                              color:
                                cnt >= cfg?.maxPerSlot
                                  ? "#C87070"
                                  : "var(--muted)",
                            }}
                          >
                            同枠 {cnt} / {cfg?.maxPerSlot}名
                          </span>
                        </p>
                      </div>
                      <button
                        className="sans"
                        onClick={() => setCancelTarget(b)}
                        style={{
                          background: "none",
                          border: "1px solid var(--border)",
                          padding: "6px 14px",
                          cursor: "pointer",
                          fontSize: 12,
                          color: "var(--muted)",
                          transition: "all 0.2s",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = "#B85C5C";
                          e.currentTarget.style.color = "#B85C5C";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = "var(--border)";
                          e.currentTarget.style.color = "var(--muted)";
                        }}
                      >
                        キャンセル
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* URL共有 */}
            <div className="card" style={{ padding: 24, marginTop: 16 }}>
              <p className="serif" style={{ fontSize: 18, marginBottom: 6 }}>
                予約URLの共有
              </p>
              <p
                className="sans"
                style={{
                  fontSize: 12,
                  color: "var(--muted)",
                  marginBottom: 16,
                }}
              >
                このURLをQRコード化してSNS・チラシに掲載しましょう。
              </p>
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <div
                  style={{
                    flex: 1,
                    minWidth: 200,
                    background: "var(--bg)",
                    padding: "11px 16px",
                    border: "1px dashed var(--border)",
                  }}
                >
                  <span
                    className="sans"
                    style={{ fontSize: 12, color: "var(--muted)" }}
                  >
                    https://gy-mproject-f-e.vercel.app/
                  </span>
                </div>
                <button
                  className="btn-p sans"
                  onClick={() => {
                    const url = window.location.origin;
                    navigator.clipboard
                      .writeText(url)
                      .then(() => showToast("✓ URLをコピーしました"))
                      .catch(() =>
                        showToast("コピーに失敗しました", "#C87070")
                      );
                  }}
                >
                  URLをコピー
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
