import { toString, noop, omit, isFunction, isEmpty, isString } from './utils';
import { parseInputArgs } from './parseInputArgs';
import { useInputId } from './useInputId';
import { useCache } from './useCache';
import { useState } from './useState';
import {
  TYPES,
  SELECT,
  CHECKBOX,
  RADIO,
  TEXTAREA,
  SELECT_MULTIPLE,
  LABEL,
  ON_CHANGE_HANDLER,
  ON_BLUR_HANDLER,
  CONSOLE_TAG,
} from './constants';

const defaultFromOptions = {
  onChange: noop,
  onBlur: noop,
  onTouched: noop,
  withIds: false,
};

export default function useFormState(initialState, options) {
  const formOptions = { ...defaultFromOptions, ...options };

  const formState = useState({ initialState });
  const { getIdProp } = useInputId(formOptions.withIds);
  const { set: setDirty, has: isDirty } = useCache();
  const callbacks = useCache();

  const missingValidateWarnings = useCache();

  const createPropsGetter = type => (...args) => {
    const { name, ownValue, ...inputOptions } = parseInputArgs(args);

    const hasOwnValue = !!toString(ownValue);
    const hasValueInState = formState.current.values[name] !== undefined;
    const isCheckbox = type === CHECKBOX;
    const isRadio = type === RADIO;
    const isSelectMultiple = type === SELECT_MULTIPLE;

    const key = `${type}.${name}.${toString(ownValue)}`;

    function setInitialValue() {
      let value = '';
      if (isCheckbox) {
        /**
         * If a checkbox has a user-defined value, its value the form state
         * value will be an array. Otherwise it will be considered a toggle.
         */
        value = hasOwnValue ? [] : false;
      }
      if (isSelectMultiple) {
        value = [];
      }
      formState.setValues({ [name]: value });
    }

    function getNextCheckboxValue(e) {
      const { value, checked } = e.target;
      if (!hasOwnValue) {
        return checked;
      }
      const checkedValues = new Set(formState.current.values[name]);
      if (checked) {
        checkedValues.add(value);
      } else {
        checkedValues.delete(value);
      }
      return Array.from(checkedValues);
    }

    function getNextSelectMultipleValue(e) {
      return Array.from(e.target.options).reduce(
        (values, option) =>
          option.selected ? [...values, option.value] : values,
        [],
      );
    }

    function validate(e, values = formState.current.values) {
      let error;
      let isValid = true;

      const value = isString(e) ? e : e.target.value;

      const customValidate =
        isFunction(inputOptions.validate) && inputOptions.validate;

      if (process.env.NODE_ENV === 'development') {
        if (isString(e) && !customValidate) {
          if (!missingValidateWarnings.has(key)) {
            // eslint-disable-next-line no-console
            console.warn(
              CONSOLE_TAG,
              `You provided a custom value for input "${name}" without a ` +
                'custom validate method. As a result, validation of this input ' +
                'will be set to "true" automatically. If you need to ' +
                'validate this input, provided a custom validation option',
            );
            missingValidateWarnings.set(key, true);
          }
        }
      }

      if (customValidate) {
        const result = customValidate(value, values, e);
        if (result !== true && result != null) {
          isValid = false;
          error = result !== false ? result : '';
        }
      } else if (!isString(e)) {
        isValid = e.target.validity.valid;
        error = e.target.validationMessage;
      }
      formState.setValidity({ [name]: isValid });
      formState.setError(isEmpty(error) ? omit(name) : { [name]: error });
    }

    function touch(e) {
      if (!formState.current.touched[name]) {
        formState.setTouched({ [name]: true });
        formOptions.onTouched(e);
      }
    }

    const inputProps = {
      name,
      get type() {
        if (type !== SELECT && type !== SELECT_MULTIPLE && type !== TEXTAREA) {
          return type;
        }
      },
      get multiple() {
        if (type === SELECT_MULTIPLE) {
          return true;
        }
      },
      get checked() {
        const { values } = formState.current;
        if (isRadio) {
          return values[name] === toString(ownValue);
        }
        if (isCheckbox) {
          if (!hasOwnValue) {
            return values[name] || false;
          }
          /**
           * @todo Handle the case where two checkbox inputs share the same
           * name, but one has a value, the other doesn't (throws currently).
           * <input {...input.checkbox('option1')} />
           * <input {...input.checkbox('option1', 'value_of_option1')} />
           */
          return hasValueInState
            ? values[name].includes(toString(ownValue))
            : false;
        }
      },
      get value() {
        // auto populating initial state values on first render
        if (!hasValueInState) {
          setInitialValue();
        }
        /**
         * Since checkbox and radio inputs have their own user-defined values,
         * and since checkbox inputs can be either an array or a boolean,
         * returning the value of input from the current form state is illogical
         */
        if (isCheckbox || isRadio) {
          return toString(ownValue);
        }
        return hasValueInState ? formState.current.values[name] : '';
      },
      onChange: callbacks.getOrSet(ON_BLUR_HANDLER + key, e => {
        setDirty(name, true);
        const hasCustomValue = inputOptions.onChange(e);
        let value = hasCustomValue != null ? hasCustomValue : e.target.value;

        /**
         * @todo check if `e` is syntactic event
         */
        if (isCheckbox) {
          value = getNextCheckboxValue(e);
        }
        if (isSelectMultiple) {
          value = getNextSelectMultipleValue(e);
        }

        const partialNewState = { [name]: value };
        const newValues = { ...formState.current.values, ...partialNewState };

        formOptions.onChange(e, formState.current.values, newValues);

        if (!inputOptions.validateOnBlur) {
          validate(e, newValues);
        }
        if (inputOptions.touchedOnChange) {
          touch(e);
        }

        formState.setValues(partialNewState);
      }),
      onBlur: callbacks.getOrSet(ON_CHANGE_HANDLER + key, e => {
        touch(e);
        inputOptions.onBlur(e);
        formOptions.onBlur(e);

        /**
         * Limiting input validation on blur to:
         * A) when it's either touched for the time
         * B) when it's marked as dirty due to a value change
         */
        if (!formState.current.touched[name] || isDirty(name)) {
          validate(e);
          setDirty(name, false);
        }
      }),
      ...getIdProp('id', name, ownValue),
    };

    return inputProps;
  };

  const inputPropsCreators = TYPES.reduce(
    (methods, type) => ({ ...methods, [type]: createPropsGetter(type) }),
    {},
  );

  return [
    formState.current,
    {
      ...inputPropsCreators,
      [LABEL]: (name, ownValue) => getIdProp('htmlFor', name, ownValue),
    },
  ];
}
