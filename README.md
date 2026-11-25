![Groundwork logo](public/groundwork.svg)

# Groundwork

Groundwork is a lightweight landscape / site editor designed to organize the design data used by an agent to generate 3D outdoor models. For example, the user defines the paths of roads and the contours of the terrain, while the program calculates slopes and local topographical details.

It was born building [i.ljm.im](https://i.ljm.im), where I want a simple and straightforward way to guide agents to generate site models, without the messiness of describing every single detail of the geometry to it (and it will make a really bad looking model if you try to do that). Groundwork is a tool to help me, the human, to organize the design data in a way that is easy for the agent to understand and use.

## Features

1. An editor for various outdoor things, with some procedural generation capabilities. We only generate things you probably don't want to model by hand, and you can overwrite them if you want to.
2. Checking if your design is valid in physical terms (not geographical).
3. Essentially, it has infinite types of objects, because you can now draw a polygon and tell the agent how to generate it by attaching prompts to it. You can also use the built-in types of objects, which are just pre-defined prompts + some structured data guide.

## Getting Started

```shell
pnpm install
pnpm dev
```

Run `pnpm test` to perform regression testing, and `pnpm check` to verify types and code.

## Contributing

You are welcome to contribute to Groundwork.

If you want to contribute, I recommend you improve the code quality, add new objects / functions, or fix bugs. You can also help me by reporting bugs and issues. This is not a requirement, but it would be very helpful.