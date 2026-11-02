import { HttpStatus } from '@nestjs/common';
import { ApiException } from '../api.exception';

/** The URL failed validation or SSRF protection. */
export class InvalidRecipeUrlException extends ApiException {
  constructor(message = 'The provided URL is not allowed.') {
    super(message, HttpStatus.BAD_REQUEST, 'INVALID_RECIPE_URL');
  }
}

/** The page was fetched but no recipe could be extracted from it. */
export class RecipeImportException extends ApiException {
  constructor(
    message = 'Could not extract a recipe from the provided URL. The page may not contain recipe data.',
  ) {
    super(message, HttpStatus.BAD_GATEWAY, 'RECIPE_IMPORT_FAILED');
  }
}
