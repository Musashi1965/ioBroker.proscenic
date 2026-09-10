# Proscenic Command PoC

This private tool verifies individual legacy Proscenic cloud commands before
they become part of the public ioBroker adapter contract.

It may authenticate, select one configured device, and send exactly one
explicitly confirmed command. It must not print or persist passwords, tokens,
serial numbers, gateway endpoints, maps, raw payloads, or private account data.

The first supported test candidates are:

- `start`
- `pause`
- `continue`
- `return`

Example:

```sh
cd tools/command-poc
export PROSCENIC_EMAIL='account@example.invalid'
npm start -- --command pause --confirm
```

Without `--confirm`, the tool logs the selected command candidate and exits
without sending it.
