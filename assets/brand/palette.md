# Brand palette

| Token | Hex | 용도 |
| --- | --- | --- |
| ink | `#1F1B2E` | 아이콘 배경, 툴바 배경, 본문 텍스트(라이트) |
| paper | `#F4F1EA` / `#FBFAF7` | 툴바 텍스트, 사이드패널 배경(라이트) |
| marker-yellow | `#FFD600` | 기본 하이라이트, primary 버튼 |
| marker-green | `#30C478` | 하이라이트 |
| marker-blue | `#409CFF` | 하이라이트 |
| marker-pink | `#FF5CAA` | 하이라이트 |
| underline-red | `#E5484D` | 밑줄, 경고 배지(orphan) |
| note-purple | `#8E4EC6` | 메모 표시(점선 밑줄), 메모 배경 tint |
| review-orange | `#F76B15` | needs-review 표시(대시 밑줄), 업데이트 배너 |

- 페이지 위 하이라이트는 원색이 아니라 **alpha 0.3–0.42** 로 칠한다 (`src/content/content.css`).
- 아이콘 원본: `icon.svg`(32px 이상), `icon-small.svg`(16px 전용 단순화 버전).
- PNG 재생성: `npm run icons`.
