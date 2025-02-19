import fs from 'fs'
import path from 'path'
import { createIg, isIgnored } from './isIgnored'
import { parseQueryFromTS } from './parseQueryFromTS'
import { replaceWithUnderscore } from './replaceWithUnderscore'

type Slugs = string[]

const createMethods = (
  indent: string,
  importName: string | undefined,
  slugs: Slugs,
  pathname: string
) =>
  `${indent}  $url: (url${importName?.startsWith('Query') ? '' : '?'}: { ${
    importName ? `query${importName.startsWith('Optional') ? '?' : ''}: ${importName}, ` : ''
  }hash?: string }) => ({ pathname: '${pathname}' as const${
    slugs.length
      ? `, query: { ${slugs.join(', ')}${
          importName ? `, ...url${importName.startsWith('Query') ? '' : '?'}.query` : ''
        } }`
      : importName
      ? `, query: url${importName.startsWith('Query') ? '' : '?'}.query`
      : ''
  }, hash: url${importName?.startsWith('Query') ? '' : '?'}.hash })`

export default (
  input: string,
  output: string,
  ignorePath: string | undefined,
  pageExtensions = ['tsx', 'ts', 'jsx', 'js']
) => {
  const ig = createIg(ignorePath)
  const regExpChunk = `\\.(${pageExtensions.join('|').replace(/\./g, '\\.')})$`
  const indexPageRegExp = new RegExp(`^index${regExpChunk}`)
  const pageExtRegExp = new RegExp(regExpChunk)
  const imports: string[] = []
  const getImportName = (file: string) => {
    const result = parseQueryFromTS(output, file, imports.length)

    if (result) {
      imports.push(result.importString)
      return result.importName
    }
  }

  const createPathObjString = (
    targetDir: string,
    indent: string,
    url: string,
    slugs: Slugs,
    text: string,
    methodsOfIndexTsFile?: string
  ) => {
    indent += '  '

    const props: string[] = fs
      .readdirSync(targetDir)
      .filter(file =>
        [
          !file.startsWith('_'),
          !/\.s?css$/.test(file),
          !file.endsWith('.d.ts'),
          `${url}/${file}` !== '/api',
          !isIgnored(ig, ignorePath, targetDir, file),
          fs.statSync(path.posix.join(targetDir, file)).isDirectory() || pageExtRegExp.test(file)
        ].every(Boolean)
      )
      .sort()
      .map(file => {
        const newSlugs = [...slugs]
        const basename = file.replace(pageExtRegExp, '')
        const newUrl = `${url}/${basename}`
        let valFn = `${indent}${replaceWithUnderscore(basename)}: {\n<% next %>\n${indent}}`

        if (basename.startsWith('[') && basename.endsWith(']')) {
          const slug = basename.replace(/[.[\]]/g, '')
          valFn = `${indent}${`_${slug}`}: (${slug}${basename.startsWith('[[') ? '?' : ''}: ${
            /\[\./.test(basename) ? 'string[]' : 'string | number'
          }) => ({\n<% next %>\n${indent}})`
          newSlugs.push(slug)
        }

        const target = path.posix.join(targetDir, file)

        if (fs.statSync(target).isFile() && basename !== 'index') {
          return valFn.replace(
            '<% next %>',
            createMethods(indent, getImportName(target), newSlugs, newUrl)
          )
        } else if (fs.statSync(target).isDirectory()) {
          const indexFile = fs.readdirSync(target).find(name => indexPageRegExp.test(name))

          return createPathObjString(
            target,
            indent,
            newUrl,
            newSlugs,
            valFn.replace('<% next %>', '<% props %>'),
            indexFile &&
              createMethods(
                indent,
                getImportName(path.posix.join(target, indexFile)),
                newSlugs,
                newUrl
              )
          )
        }

        return ''
      })
      .filter(Boolean)

    const joinedProps = props
      .reduce<string[]>((accumulator, current) => {
        const last = accumulator[accumulator.length - 1]

        if (last !== undefined) {
          const [a, ...b] = last.split('\n')
          const [x, ...y] = current.split('\n')

          if (a === x) {
            y.pop()
            const z = y.pop()
            const merged = [a, ...y, `${z},`, ...b].join('\n')
            return [...accumulator.slice(0, -1), merged]
          }
        }

        return [...accumulator, current]
      }, [])
      .join(',\n')

    return text.replace(
      '<% props %>',
      `${joinedProps}${
        methodsOfIndexTsFile ? `${props.length ? ',\n' : ''}${methodsOfIndexTsFile}` : ''
      }`
    )
  }

  const rootIndexFile = fs.readdirSync(input).find(name => indexPageRegExp.test(name))
  const rootIndent = ''
  let rootMethods

  if (rootIndexFile) {
    rootMethods = createMethods(
      rootIndent,
      getImportName(path.posix.join(input, rootIndexFile)),
      [],
      '/'
    )
  }

  const text = createPathObjString(input, rootIndent, '', [], `{\n<% props %>\n}`, rootMethods)

  return `${imports.join('\n')}${
    imports.length ? '\n\n' : ''
  }export const pagesPath = ${text}\n\nexport type PagesPath = typeof pagesPath
`
}
