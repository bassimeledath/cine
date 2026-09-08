import Ajv from 'ajv'
import schema from '../../schemas/project-v2.schema.json' with { type: 'json' }
import { CineError } from './errors.mjs'
const validate = new Ajv({ allErrors: true, strict: false }).compile(schema)
export function validateDocument(project, { requireCapture = true } = {}) {
  const input = requireCapture
    ? project
    : { ...project, capture: project.capture ?? 'fixture/meta.json' }
  if (project.schemaVersion === 2 && !validate(input)) {
    const errors = validate.errors.filter(
      (e) => !['oneOf', 'anyOf'].includes(e.keyword),
    )
    errors.sort((a, b) => b.instancePath.length - a.instancePath.length)
    const first = errors[0],
      path =
        (first.instancePath || 'project') +
        (first.keyword === 'required' ? '/' + first.params.missingProperty : '')
    throw new CineError(
      'SCHEMA_VALIDATION',
      path,
      first.message,
      'Run cine capabilities --json and consult schemas/project-v2.schema.json',
    )
  }
}
