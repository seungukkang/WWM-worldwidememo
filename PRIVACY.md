# Privacy Policy — WWM (WorldWideMemo)

_Effective date: 2026-10-28 · [한국어](#개인정보처리방침-한국어)_

WWM is a browser extension that lets you highlight, underline, bold and annotate text on web pages, and restores those annotations when you revisit a page — even after the page has changed.

## Summary

- **Everything stays on your device.** Your annotations are stored in your browser's local extension storage (`chrome.storage.local`).
- **Nothing is sent to us or to anyone else.** WWM has no server, no account, no analytics, no ads and no tracking.
- **We never sell or share data.**

## What WWM stores (locally)

Only when **you create an annotation**, WWM stores:

| Data | Why |
| --- | --- |
| The text you selected, plus up to 32 characters before and after it | To find the same place again when you revisit the page |
| A short excerpt (up to ~400 characters) around the selection | To relocate your annotation if the page changes, and to show you what changed |
| Your note, chosen style (color / underline / bold), creation and update times | That is the annotation itself |
| The page URL and title | To know which page the annotation belongs to |
| For PDFs: the document's fingerprint (an ID computed from the file) | To recognize the same PDF again |
| A short undo history of your edits on each page (`chrome.storage.session`, cleared when you close the browser) | So you can undo / redo your edits |

WWM does **not** store full page contents, your browsing history, or anything about pages where you have not created an annotation.

## PDFs

Chrome's built-in PDF viewer cannot be used by extensions, so WWM includes its own PDF viewer (based on the open-source [pdf.js](https://mozilla.github.io/pdf.js/)).
When you open a PDF in WWM, your browser downloads it directly from the site it came from — the same request Chrome would make — and renders it on your device.
The PDF itself is not stored by WWM and is never sent anywhere. When you open a PDF in Chrome, WWM only checks locally whether you already have annotations for that PDF's URL.

## Permissions

| Permission | Purpose |
| --- | --- |
| Access to http/https sites | Required to show your saved annotations automatically when you revisit a page, and to let you annotate any page. Page content is read locally and never transmitted. |
| `storage`, `unlimitedStorage` | Save your annotations locally without running out of space. |
| `sidePanel` | Show the list of your annotations. |
| `contextMenus` | Offer "Highlight" / "Add note" on right-click. |

## Your control

- Delete any annotation from the in-page popover or the side panel.
- Export all of your data as JSON from the side panel at any time.
- Uninstalling the extension removes all locally stored data.

## Future features

If a future version adds an optional feature that transfers data (for example, syncing across your devices through **your own** Google Drive), it will be **off by default**, require your explicit opt-in, and this policy will be updated before that version is released.

## Chrome Web Store User Data Policy

The use of information received by WWM adheres to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including the Limited Use requirements.

## Contact

Questions or concerns: open an issue at <https://github.com/seungukkang/WWM-worldwidememo/issues>.

---

# 개인정보처리방침 (한국어)

_시행일: 2026-10-28_

WWM은 웹페이지의 텍스트에 하이라이트·밑줄·볼드·메모를 남기고, 페이지가 바뀌어도 다시 방문했을 때 주석을 복원해 주는 브라우저 확장 프로그램입니다.

## 요약

- **모든 데이터는 사용자 기기에만 저장됩니다.** 주석은 브라우저의 확장 프로그램 로컬 저장소(`chrome.storage.local`)에 보관됩니다.
- **개발자나 제3자에게 아무것도 전송하지 않습니다.** 서버, 계정, 분석 도구, 광고, 추적이 없습니다.
- **데이터를 판매하거나 공유하지 않습니다.**

## 저장하는 정보 (로컬)

**사용자가 주석을 만들 때에만** 다음을 저장합니다.

| 정보 | 이유 |
| --- | --- |
| 선택한 텍스트와 앞뒤 최대 32자 | 재방문 시 같은 위치를 찾기 위해 |
| 선택 영역 주변 약 400자 이내의 짧은 발췌 | 페이지가 바뀌었을 때 주석 위치를 다시 찾고, 무엇이 바뀌었는지 보여주기 위해 |
| 메모, 스타일(색상/밑줄/볼드), 생성·수정 시각 | 주석 그 자체 |
| 페이지 URL과 제목 | 주석이 어느 페이지에 속하는지 알기 위해 |
| PDF의 경우: 문서 fingerprint (파일에서 계산한 식별값) | 같은 PDF를 다시 알아보기 위해 |
| 페이지별 최근 편집 기록 (`chrome.storage.session`, 브라우저를 닫으면 삭제) | 실행 취소 / 다시 실행을 위해 |

페이지 전체 내용, 방문 기록, 주석을 만들지 않은 페이지에 대한 정보는 **저장하지 않습니다.**

## PDF

Chrome 기본 PDF 뷰어에는 확장 프로그램이 동작할 수 없어서, WWM은 자체 PDF 뷰어(오픈소스 [pdf.js](https://mozilla.github.io/pdf.js/) 기반)를 포함하고 있습니다.
PDF를 WWM으로 열면 브라우저가 원래 사이트에서 직접 파일을 내려받아(Chrome이 보낼 것과 같은 요청) 기기 안에서 화면에 표시합니다.
WWM은 PDF 파일 자체를 저장하지 않으며 어디에도 전송하지 않습니다. Chrome에서 PDF를 열 때는 해당 PDF 주소에 이미 주석이 있는지 기기 안에서만 확인합니다.

## 권한

| 권한 | 용도 |
| --- | --- |
| http/https 사이트 접근 | 재방문 시 저장된 주석을 자동으로 표시하고, 어느 페이지에서나 주석을 달 수 있게 하기 위해 필요합니다. 페이지 내용은 기기 안에서만 읽고 전송하지 않습니다. |
| `storage`, `unlimitedStorage` | 주석을 용량 걱정 없이 로컬에 저장 |
| `sidePanel` | 주석 목록 표시 |
| `contextMenus` | 우클릭 메뉴의 "하이라이트" / "메모 추가" |

## 사용자의 권리

- 페이지 위 팝오버나 사이드패널에서 언제든 주석을 삭제할 수 있습니다.
- 사이드패널에서 모든 데이터를 JSON으로 내보낼 수 있습니다.
- 확장 프로그램을 삭제하면 로컬에 저장된 모든 데이터가 함께 삭제됩니다.

## 향후 기능

향후 버전에서 데이터를 전송하는 선택 기능(예: **사용자 본인의** Google Drive를 통한 기기 간 동기화)을 추가하는 경우, 해당 기능은 **기본적으로 꺼져 있으며** 명시적인 동의 후에만 동작하고, 그 버전을 배포하기 전에 이 방침을 먼저 갱신합니다.

## 문의

<https://github.com/seungukkang/WWM-worldwidememo/issues> 에 이슈를 남겨 주세요.
