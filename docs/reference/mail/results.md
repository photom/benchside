# Results

## Receiver results

| ID | Requirement |
|---|---|
| AR-1 | Parses `Authentication-Results` (RFC 8601) and `Received-SPF` (RFC 7208 §9.1) fields. |
| AR-2 | Compares the results recorded by the receiver with the analyzer's results, method by method, and highlights differences. |
| AR-3 | For each difference, lists likely causes: key rotation since delivery, forwarding, a wrong trust-boundary choice, or line-ending conversion. |
| AR-4 | Marks `Authentication-Results` fields added above the trust boundary as untrusted, because senders can forge them. |

## Report

| ID | Requirement |
|---|---|
| OUT-1 | Starts with a summary: one line each for SPF, DKIM, DKIM2, DMARC, and ARC. Each line expands into its detailed evaluation. |
| OUT-2 | Every finding has an ID, a severity (`error`, `warning`, `info`), a message, and links to the header fields, byte ranges, and DNS queries it is based on. |
| OUT-3 | "Not evaluated" is distinct from every failure result and always states the reason. |
| OUT-4 | The report can be exported as JSON. The export is generated locally and contains no message content unless the user includes it. |

## Non-functional

| ID | Requirement |
|---|---|
| NF-1 | Parsing and cryptography run in a Web Worker. |
| NF-2 | Cryptography uses Web Crypto only. |
| NF-3 | The page loads no resources from other origins and connects only to the DoH providers (see [DNS](dns.md)). |
| NF-4 | Malformed input never throws an uncaught error. It produces findings. |
| NF-5 | Analysis of a 1 MiB message completes in under 1 second, excluding DNS time. |
