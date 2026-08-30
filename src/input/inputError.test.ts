import { describe, expect, it } from 'bun:test';

import { InputFileError } from './inputError';

describe('InputFileError', () => {
  it('carries an HTTP status code and is an Error', () => {
    const error = new InputFileError('too large', 413);

    expect(error.message).toBe('too large');
    expect(error.status).toBe(413);
    expect(error).toBeInstanceOf(Error);
  });
});
