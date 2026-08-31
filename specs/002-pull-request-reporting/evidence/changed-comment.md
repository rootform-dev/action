<!-- rootform:architecture-review -->

## Rootform architecture review

`base:ddc7884` → `head:c3548d2`

> [!WARNING]
> Architecture changes detected.

| Review gate | Result |
| --- | --- |
| Architecture | ⚠️ Changes detected |
| Policies | ✅ Passed |
| Rootform | `0.1.0-dev.2` |

<details open>
<summary><strong>Architecture changes</strong></summary>

## Rootform diff

| Change | What |
| --- | --- |
| added | context "core/network" from entity:aws_internet_gateway.main to scope:aws_vpc.main |
| removed | context "core/network" from scope:aws_subnet.application to scope:aws_vpc.main |
| added | context "core/network" from scope:aws_subnet.public to scope:aws_vpc.main |
| added | aws/internet-gateway "main" |
| removed | core/subnet "application" |
| added | core/subnet "public" |

</details>

<details>
<summary><strong>Policy checks</strong></summary>

## Rootform check

0 policies, 0 evaluations, 0 passed, 0 violated, 0 indeterminate

</details>

### Evidence

[Download complete evidence](https://github.com/rootform-dev/action/actions/runs/33447403911/artifacts/9778517589) · [Open workflow run](https://github.com/rootform-dev/action/actions/runs/33447403911)

<details>
<summary>Run provenance</summary>

- Mode: `source`
- Current input: `test/e2e/pull-request-reporting/current`
- Baseline input: `test/e2e/pull-request-reporting/before`
- Base commit: `ddc78843e488fff794de42b3f4732884ce1b22cc`
- Head commit: `c3548d2bb51d80e2168d90f211e047575c378461`

</details>
