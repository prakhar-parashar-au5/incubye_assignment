# Feature specification template

Copy this template into `docs_human/` for each new feature. Remove sections that do not apply. Keep the decisions in your own words.

```markdown
# Feature name

## User and problem

Who uses this feature?

What problem are they trying to solve?

Why is the current workflow difficult or unsafe?

## Outcome

What can the user complete after this feature exists?

## Main journey

1.
2.
3.

## Included behavior

- 

## Business rules

- 

## Data and calculations

What data is read?

What data is written?

Which values are authoritative?

Which values are calculated?

What currency, date, time-zone, and rounding rules apply?

## Permissions

What can Admin HR do?

What can Scoped HR do?

What must never be disclosed?

## Concurrency and retry

Can two users change the same record?

How do we detect stale data?

What happens when the same request is sent twice?

## API or interface

Inputs:

Outputs:

Important error results:

## User interface states

- Loading:
- Empty:
- Invalid input:
- Permission denied:
- Conflict:
- Service unavailable:
- Success:

## Examples

### Normal example

### Boundary example

### Failure example

## Tests I expect

### Unit tests

- 

### Real-database integration tests

- 

### API tests

- 

### Browser tests

- 

## Security and privacy

What sensitive data exists?

What must not enter logs, URLs, browser storage, model input, or public search?

## Performance

What is the expected data size?

Which query or interaction needs measurement?

## Deliberately excluded

- 

## Open questions

- 
```

## Test-writing check

For each important test, write:

```text
Given:
When:
Then:
Plausible bug caught:
```

Example:

```text
Given: Two HR users preview compensation version 3.
When: The first user confirms a change and the second user then confirms.
Then: The second confirmation returns a stale-version conflict.
Plausible bug caught: A later request silently overwrites the first user's salary change.
```
