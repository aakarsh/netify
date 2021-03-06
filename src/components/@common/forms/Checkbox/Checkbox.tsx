import React, {memo, ReactNode} from 'react';
import cn from 'classnames';
import styles from './checkbox.css';

type NativeInputProps = React.DetailedHTMLProps<React.InputHTMLAttributes<HTMLInputElement>, HTMLInputElement>;
interface CheckboxProps extends Omit<NativeInputProps, 'type'> {
	children?: ReactNode;
}

export const Checkbox = memo<CheckboxProps>(function Checkbox({className, children, ...nativeProps}) {
	return (
		<label className={cn(styles.root, className)}>
			<input {...nativeProps} className={styles.input} type='checkbox' />
			<div className={styles.label}>{children}</div>
		</label>
	);
});
