function main(args) {
    let name = args.name || 'Paiboon'
    let greeting = 'Hello ' + name + '!'
    console.log(greeting)
    return {"body": greeting}
}
